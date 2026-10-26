import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { AppSettings, AppState, Exam, ExamSection, Learner, ScanResult } from '../types';
import { makeExam, normalizeExam, seedState } from '../lib/grading';
import {
  answerShape,
  buildExamWithSections,
  carryManualScores,
  examSections,
  manualSlots,
  materializeItems,
  remapAnswerKeys,
  totalItemCount,
} from '../lib/sections';
import { distributeItems, tosTotals } from '../lib/tos';
import { recalculateResult } from '../lib/results';
import { uid, examCode } from '../lib/id';
import { createEmptyState } from '../lib/storage';
import { workspaceStorage, type SnapshotReason } from '../lib/workspaceStorage';

interface AppContextValue {
  state: AppState;
  activeExam: Exam | null;
  activeLearners: Learner[];
  activeResults: ScanResult[];
  setActiveExam: (id: string | null) => void;
  createExam: (partial: Partial<Exam>) => string;
  updateExam: (id: string, patch: Partial<Exam>) => void;
  deleteExam: (id: string) => void;
  duplicateExam: (id: string) => string | null;
  /** Replace the test parts. Returns whether old scans had to be cleared. */
  applySections: (id: string, sections: ExamSection[]) => { removed: boolean };
  resizeExam: (id: string, itemCount: number, choiceCount: 4 | 5) => void;
  addLearners: (examId: string, rows: Array<Omit<Learner, 'id' | 'examId' | 'status'> & { status?: Learner['status'] }>) => { added: number; duplicates: string[] };
  updateLearner: (learnerId: string, patch: Partial<Learner>) => void;
  deleteLearner: (learnerId: string) => void;
  saveResult: (result: ScanResult) => { replaced: boolean };
  deleteResult: (resultId: string) => void;
  updateResult: (resultId: string, patch: Partial<ScanResult>) => void;
  clearExamResults: (examId: string) => void;
  updateSettings: (patch: Partial<AppSettings>) => void;
  importWorkspace: (next: AppState) => void;
  resetWorkspace: () => void;
  loadDemoWorkspace: () => void;
  loadDemoResults: (examId: string) => void;
  toast: (message: string, tone?: 'default' | 'success' | 'danger') => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children, initialState }: { children: React.ReactNode; initialState: AppState }) {
  const [state, setState] = useState<AppState>(initialState);
  const [toastMessage, setToastMessage] = useState<{ id: number; message: string; tone: 'default' | 'success' | 'danger' } | null>(null);
  const toastTimer = useRef<number | null>(null);
  const stateRef = useRef<AppState>(initialState);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void workspaceStorage.save(state);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [state]);

  // The debounced save may not have run when the window closes. Flush the
  // latest state directly so the last few keystrokes survive.
  useEffect(() => {
    const flush = () => {
      void workspaceStorage.flush(stateRef.current);
    };
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      window.removeEventListener('pagehide', flush);
    };
  }, []);

  const snapshotNow = useCallback((reason: SnapshotReason) => {
    void workspaceStorage.snapshot(stateRef.current, reason);
  }, []);

  const toast = useCallback((message: string, tone: 'default' | 'success' | 'danger' = 'default') => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToastMessage({ id: Date.now(), message, tone });
    toastTimer.current = window.setTimeout(() => setToastMessage(null), 3600);
  }, []);

  const setActiveExam = useCallback((id: string | null) => {
    setState((prev) => ({ ...prev, activeExamId: id }));
  }, []);

  const createExam = useCallback((partial: Partial<Exam>) => {
    const exam = makeExam(partial);
    setState((prev) => ({ ...prev, exams: [exam, ...prev.exams], activeExamId: exam.id }));
    return exam.id;
  }, []);

  const updateExam = useCallback((id: string, patch: Partial<Exam>) => {
    setState((prev) => {
      const current = prev.exams.find((exam) => exam.id === id);
      if (!current) return prev;
      const nextExam = buildExamWithSections(
        { ...current, ...patch, updatedAt: new Date().toISOString() },
        patch.sections ?? examSections(current)
      );
      return {
        ...prev,
        exams: prev.exams.map((exam) => (exam.id === id ? nextExam : exam)),
        // A corrected key, a changed part, or a new transmutation policy must
        // restate every existing score immediately.
        results: prev.results.map((result) =>
          result.examId === id ? recalculateResult(nextExam, result, { keepReview: true }) : result
        ),
      };
    });
  }, []);

  const applySections = useCallback(
    (id: string, sections: ExamSection[]) => {
      const current = state.exams.find((exam) => exam.id === id);
      if (!current) return { removed: false };
      const nextExam = buildExamWithSections(current, sections);
      const removed = answerShape(examSections(current)) !== answerShape(examSections(nextExam));
      if (removed) snapshotNow('structure');
      setState((prev) => {
        const base = prev.exams.find((exam) => exam.id === id) ?? current;
        const built = remapAnswerKeys(base, buildExamWithSections(base, sections));
        const totalBefore = totalItemCount(base);
        const totalAfter = totalItemCount(built);
        // Keep the TOS in step with Setup when it was fully allocated for the
        // old total. A deliberately partial TOS is left alone and keeps warning.
        const exam =
          base.tos && totalBefore !== totalAfter && tosTotals(base.tos).allocated === totalBefore
            ? { ...built, tos: distributeItems(base.tos, totalAfter) }
            : built;
        return {
          ...prev,
          exams: prev.exams.map((entry) => (entry.id === id ? exam : entry)),
          // Written parts can grow or shrink without touching a single scan.
          // Only a change to the scannable block makes old sheets unreadable.
          results: removed
            ? prev.results.filter((result) => result.examId !== id)
            : prev.results.map((result) => {
                if (result.examId !== id) return result;
                const manualScores = carryManualScores(base, exam, result.manualScores);
                return recalculateResult(
                  exam,
                  manualScores === result.manualScores ? result : { ...result, manualScores },
                  { keepReview: true }
                );
              }),
        };
      });
      return { removed };
    },
    [state.exams, snapshotNow]
  );

  const deleteExam = useCallback((id: string) => {
    if (stateRef.current.exams.some((exam) => exam.id === id)) snapshotNow('exam');
    setState((prev) => ({
      ...prev,
      exams: prev.exams.filter((exam) => exam.id !== id),
      learners: prev.learners.filter((learner) => learner.examId !== id),
      results: prev.results.filter((result) => result.examId !== id),
      activeExamId: prev.activeExamId === id ? null : prev.activeExamId,
    }));
  }, [snapshotNow]);

  const duplicateExam = useCallback((id: string) => {
    const source = state.exams.find((exam) => exam.id === id);
    if (!source) return null;
    const exam = makeExam({
      ...source,
      id: uid('EXAM'),
      code: examCode(),
      title: `${source.title} (copy)`,
      answerKey: [...source.answerKey],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const learners = state.learners
      .filter((learner) => learner.examId === id)
      .map((learner) => ({ ...learner, id: `${exam.id}:${learner.lrn}`, examId: exam.id }));
    setState((prev) => ({
      ...prev,
      exams: [exam, ...prev.exams],
      learners: [...prev.learners, ...learners],
      activeExamId: exam.id,
    }));
    return exam.id;
  }, [state.exams, state.learners]);

  const resizeExam = useCallback((id: string, itemCount: number, choiceCount: 4 | 5) => {
    if (stateRef.current.results.some((result) => result.examId === id)) snapshotNow('structure');
    setState((prev) => {
      const current = prev.exams.find((exam) => exam.id === id);
      if (!current) return prev;
      // Legacy entry point: resize the first part only.
      const sections = examSections(current).map((section, index) =>
        index === 0
          ? { ...section, itemCount, ...(section.type === 'MCQ' ? { choices: choiceCount } : {}) }
          : section
      );
      const exam = buildExamWithSections(current, sections);
      return {
        ...prev,
        exams: prev.exams.map((entry) => (entry.id === id ? exam : entry)),
        results: prev.results.filter((result) => result.examId !== id),
      };
    });
  }, [snapshotNow]);

  const addLearners = useCallback((examId: string, rows: Array<Omit<Learner, 'id' | 'examId' | 'status'> & { status?: Learner['status'] }>) => {
    const existing = new Set(
      state.learners.filter((learner) => learner.examId === examId).map((learner) => learner.lrn)
    );
    const duplicates: string[] = [];
    const nextLearners: Learner[] = [];
    rows.forEach((row) => {
      const lrn = row.lrn.trim();
      if (!lrn) return;
      if (existing.has(lrn)) {
        duplicates.push(lrn);
        return;
      }
      existing.add(lrn);
      nextLearners.push({
        id: `${examId}:${lrn}`,
        examId,
        lrn,
        name: row.name.trim(),
        sex: row.sex,
        status: row.status ?? 'Active',
      });
    });
    if (nextLearners.length > 0) {
      setState((prev) => ({ ...prev, learners: [...prev.learners, ...nextLearners] }));
    }
    return { added: nextLearners.length, duplicates };
  }, [state.learners]);

  const updateLearner = useCallback((learnerId: string, patch: Partial<Learner>) => {
    setState((prev) => {
      const current = prev.learners.find((learner) => learner.id === learnerId);
      if (!current) return prev;
      const nextLrn = patch.lrn?.trim() || current.lrn;
      return {
        ...prev,
        learners: prev.learners.map((learner) =>
          learner.id === learnerId
            ? { ...learner, ...patch, lrn: nextLrn, id: `${learner.examId}:${nextLrn}` }
            : learner
        ),
        results: prev.results.map((result) =>
          result.examId === current.examId && result.lrn === current.lrn
            ? {
                ...result,
                lrn: nextLrn,
                name: patch.name ?? result.name,
                id: `RES-${current.examId}-${nextLrn}`,
              }
            : result
        ),
      };
    });
  }, []);

  const deleteLearner = useCallback((learnerId: string) => {
    if (stateRef.current.learners.some((item) => item.id === learnerId)) snapshotNow('learner');
    setState((prev) => {
      const learner = prev.learners.find((item) => item.id === learnerId);
      return {
        ...prev,
        learners: prev.learners.filter((item) => item.id !== learnerId),
        results: learner
          ? prev.results.filter((result) => !(result.examId === learner.examId && result.lrn === learner.lrn))
          : prev.results,
      };
    });
  }, [snapshotNow]);

  const saveResult = useCallback((result: ScanResult) => {
    const index = state.results.findIndex(
      (item) => item.examId === result.examId && item.lrn === result.lrn
    );
    const replaced = index >= 0;
    setState((prev) => {
      const idx = prev.results.findIndex(
        (item) => item.examId === result.examId && item.lrn === result.lrn
      );
      const exam = prev.exams.find((item) => item.id === result.examId);
      if (idx >= 0) {
        const existing = prev.results[idx];
        // Re-scanning a sheet must not wipe written scores already typed by hand.
        const merged = {
          ...result,
          manualScores: result.manualScores ?? existing.manualScores,
        };
        const nextResult = exam ? recalculateResult(exam, merged, { keepReview: true }) : merged;
        const next = [...prev.results];
        next[idx] = nextResult;
        return { ...prev, results: next };
      }
      const fresh = exam ? recalculateResult(exam, result, { keepReview: true }) : result;
      return { ...prev, results: [...prev.results, fresh] };
    });
    return { replaced };
  }, [state.results]);

  const deleteResult = useCallback((resultId: string) => {
    if (stateRef.current.results.some((item) => item.id === resultId)) snapshotNow('result');
    setState((prev) => ({ ...prev, results: prev.results.filter((item) => item.id !== resultId) }));
  }, [snapshotNow]);

  const updateResult = useCallback((resultId: string, patch: Partial<ScanResult>) => {
    setState((prev) => {
      const current = prev.results.find((item) => item.id === resultId);
      if (!current) return prev;
      const exam = prev.exams.find((item) => item.id === current.examId);
      const merged = { ...current, ...patch };
      const next = exam ? recalculateResult(exam, merged, { keepReview: true }) : merged;
      return {
        ...prev,
        results: prev.results.map((item) => (item.id === resultId ? next : item)),
      };
    });
  }, []);

  const clearExamResults = useCallback((examId: string) => {
    if (stateRef.current.results.some((item) => item.examId === examId)) snapshotNow('results');
    setState((prev) => ({ ...prev, results: prev.results.filter((item) => item.examId !== examId) }));
  }, [snapshotNow]);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setState((prev) => ({
      ...prev,
      settings: { ...prev.settings, ...patch },
      exams: prev.exams.map((exam) =>
        exam.id === prev.activeExamId
          ? {
              ...exam,
              paper: patch.paper ?? exam.paper,
              orientation: patch.orientation ?? exam.orientation,
              sheetsPerPage: patch.sheetsPerPage ?? exam.sheetsPerPage,
              passingPercent: patch.passingPercent ?? exam.passingPercent,
              depedPolicy: patch.depedPolicy ?? exam.depedPolicy,
            }
          : exam
      ),
    }));
  }, []);

  const importWorkspace = useCallback((next: AppState) => {
    const current = stateRef.current;
    if (current.exams.length > 0 || current.learners.length > 0 || current.results.length > 0) {
      snapshotNow('import');
    }
    setState({
      ...createEmptyState(),
      ...next,
      settings: { ...createEmptyState().settings, ...next.settings },
      exams: next.exams.map(normalizeExam),
    });
  }, [snapshotNow]);

  const resetWorkspace = useCallback(() => {
    const current = stateRef.current;
    if (current.exams.length > 0 || current.learners.length > 0 || current.results.length > 0) {
      snapshotNow('reset');
    }
    setState(createEmptyState());
  }, [snapshotNow]);

  const loadDemoWorkspace = useCallback(() => {
    const demo = seedState();
    setState((prev) => ({
      ...createEmptyState(),
      settings: prev.settings,
      exams: [demo.exam, ...prev.exams],
      learners: [...prev.learners, ...demo.learners],
      activeExamId: demo.exam.id,
    }));
  }, []);

  const loadDemoResults = useCallback((examId: string) => {
    if (stateRef.current.results.some((result) => result.examId === examId)) snapshotNow('demo');
    setState((prev) => {
      const exam = prev.exams.find((item) => item.id === examId);
      const learners = prev.learners.filter((learner) => learner.examId === examId);
      if (!exam || learners.length === 0) return prev;
      const items = materializeItems(exam);
      const scannable = items.filter((item) => item.scannable);
      const written = manualSlots(exam);

      const results: ScanResult[] = learners.slice(0, 10).map((learner, learnerIndex) => {
        // Demo only: give each learner a stable ability so the class spread, the
        // item difficulty, and the reliability figures read like a real test.
        const ability = 0.42 + ((learnerIndex * 7) % 9) * 0.06;
        const answers = scannable.map((item, index) => {
          const key = exam.answerKey[item.answerIndex ?? index] ?? '';
          if (!key) return null;
          if (index < 2 && learnerIndex % 5 === 0) return null;
          const roll = (index * 37 + learnerIndex * 61 + 17) % 100;
          if (roll < 3) return null;
          const chance = Math.round(ability * 100 + ((index * 13) % 21) - 10);
          if (roll < chance) return key;
          const alternatives = item.choices.filter((choice) => choice !== key);
          return alternatives[(index * 5 + learnerIndex * 3) % Math.max(1, alternatives.length)] ?? null;
        });

        // Demo written scores: mostly partial credit, so the combined total and
        // the partial-credit analysis have something to show.
        const manualScores: Record<string, number> = {};
        written.forEach((slot, index) => {
          const fraction = 0.45 + ((index * 17 + learnerIndex * 11) % 56) / 100;
          manualScores[slot.key] = Math.round(slot.points * fraction * 100) / 100;
        });

        const base: ScanResult = {
          id: `DEMO-${exam.id}-${learner.lrn}`,
          examId,
          lrn: learner.lrn,
          name: learner.name,
          answers,
          flags: [],
          correctCount: 0,
          total: 0,
          percentage: 0,
          grade: 60,
          scannedAt: new Date(Date.now() - learnerIndex * 60000).toISOString(),
          sourceFile: 'Demo results (not a real scan)',
          pageNumber: learnerIndex + 1,
          qrOk: true,
          needsReview: false,
          manualOverride: false,
          manualScores: written.length > 0 ? manualScores : undefined,
        };
        return recalculateResult(exam, base, { keepReview: true });
      });
      return {
        ...prev,
        results: [
          ...prev.results.filter((result) => result.examId !== examId),
          ...results,
        ],
      };
    });
  }, [snapshotNow]);

  const activeExam = useMemo(
    () => state.exams.find((exam) => exam.id === state.activeExamId) ?? null,
    [state.exams, state.activeExamId]
  );
  const activeLearners = useMemo(
    () => state.learners.filter((learner) => learner.examId === state.activeExamId),
    [state.learners, state.activeExamId]
  );
  const activeResults = useMemo(
    () => state.results.filter((result) => result.examId === state.activeExamId),
    [state.results, state.activeExamId]
  );

  const value: AppContextValue = {
    state,
    activeExam,
    activeLearners,
    activeResults,
    setActiveExam,
    createExam,
    updateExam,
    deleteExam,
    duplicateExam,
    applySections,
    resizeExam,
    addLearners,
    updateLearner,
    deleteLearner,
    saveResult,
    deleteResult,
    updateResult,
    clearExamResults,
    updateSettings,
    importWorkspace,
    resetWorkspace,
    loadDemoWorkspace,
    loadDemoResults,
    toast,
  };

  return (
    <AppContext.Provider value={value}>
      {children}
      {toastMessage && (
        <div className={`toast toast--${toastMessage.tone}`} role="status" key={toastMessage.id}>
          {toastMessage.message}
        </div>
      )}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside AppProvider');
  return context;
}
