// Tsek desktop shell.
//
// The whole app is local: the webview renders the UI and these commands own the
// only persistent state, two plain JSON files in the app data folder. Keeping
// the file work here (instead of a browser storage API) means a class record
// survives a cache clear and can be copied to another machine.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

const WORKSPACE_FILE: &str = "workspace.json";
const SNAPSHOT_DIR: &str = "snapshots";
const SNAPSHOT_EXT: &str = "json";

fn data_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("the app data folder is unavailable: {error}"))?;
    fs::create_dir_all(&dir).map_err(|error| format!("could not create {}: {error}", dir.display()))?;
    Ok(dir)
}

fn snapshot_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = data_root(app)?.join(SNAPSHOT_DIR);
    fs::create_dir_all(&dir).map_err(|error| format!("could not create {}: {error}", dir.display()))?;
    Ok(dir)
}

/// Snapshot ids come from the UI, so treat them as untrusted: only letters,
/// digits and dashes, which also rules out path traversal.
fn checked_id(id: &str) -> Result<&str, String> {
    if id.is_empty() || id.len() > 80 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("invalid snapshot id".to_string());
    }
    Ok(id)
}

/// Write through a temporary file so a crash mid-write cannot leave a truncated
/// workspace behind: the old file stays valid until the rename succeeds.
fn write_atomic(path: &Path, contents: &str) -> Result<(), String> {
    let temp = path.with_extension("tmp");
    {
        let mut file = fs::File::create(&temp)
            .map_err(|error| format!("could not open {}: {error}", temp.display()))?;
        file.write_all(contents.as_bytes())
            .map_err(|error| format!("could not write {}: {error}", temp.display()))?;
        file.sync_all()
            .map_err(|error| format!("could not flush {}: {error}", temp.display()))?;
    }
    fs::rename(&temp, path).map_err(|error| format!("could not replace {}: {error}", path.display()))
}

#[tauri::command]
fn storage_load(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = data_root(&app)?.join(WORKSPACE_FILE);
    match fs::read_to_string(&path) {
        Ok(contents) => Ok(Some(contents)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("could not read {}: {error}", path.display())),
    }
}

#[tauri::command]
fn storage_save(app: tauri::AppHandle, raw: String) -> Result<(), String> {
    let path = data_root(&app)?.join(WORKSPACE_FILE);
    write_atomic(&path, &raw)
}

#[tauri::command]
fn storage_path(app: tauri::AppHandle) -> Result<String, String> {
    Ok(data_root(&app)?.join(WORKSPACE_FILE).to_string_lossy().to_string())
}

#[tauri::command]
fn snapshot_write(app: tauri::AppHandle, id: String, payload: String) -> Result<(), String> {
    let id = checked_id(&id)?;
    let path = snapshot_root(&app)?.join(format!("{id}.{SNAPSHOT_EXT}"));
    write_atomic(&path, &payload)
}

/// Newest first. Ids start with a millisecond timestamp, so a plain sort is
/// chronological without reading every file.
#[tauri::command]
fn snapshot_list(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let dir = snapshot_root(&app)?;
    let mut ids: Vec<String> = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|error| format!("could not list {}: {error}", dir.display()))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some(SNAPSHOT_EXT) {
            continue;
        }
        if let Some(stem) = path.file_stem().and_then(|value| value.to_str()) {
            if checked_id(stem).is_ok() {
                ids.push(stem.to_string());
            }
        }
    }
    ids.sort_unstable();
    ids.reverse();
    Ok(ids)
}

#[tauri::command]
fn snapshot_read(app: tauri::AppHandle, id: String) -> Result<Option<String>, String> {
    let id = checked_id(&id)?;
    let path = snapshot_root(&app)?.join(format!("{id}.{SNAPSHOT_EXT}"));
    match fs::read_to_string(&path) {
        Ok(contents) => Ok(Some(contents)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("could not read {}: {error}", path.display())),
    }
}

/// Drop everything past `keep`, oldest last, so the folder never grows.
#[tauri::command]
fn snapshot_prune(app: tauri::AppHandle, keep: usize) -> Result<(), String> {
    let dir = snapshot_root(&app)?;
    let mut files: Vec<PathBuf> = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|error| format!("could not list {}: {error}", dir.display()))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) == Some(SNAPSHOT_EXT) {
            files.push(path);
        }
    }
    files.sort();
    files.reverse();
    for path in files.into_iter().skip(keep) {
        fs::remove_file(&path).map_err(|error| format!("could not remove {}: {error}", path.display()))?;
    }
    Ok(())
}

/// Sheet PDFs, result JSON, and CSV leave through a Windows save dialog, so the
/// teacher decides where the class record goes. Returns the chosen path, or None
/// when the dialog was cancelled.
#[tauri::command]
async fn save_export(
    app: tauri::AppHandle,
    filename: String,
    bytes: Vec<u8>,
) -> Result<Option<String>, String> {
    let picked = app
        .dialog()
        .file()
        .set_file_name(&filename)
        .blocking_save_file();
    let Some(target) = picked else {
        return Ok(None);
    };
    let path = target
        .into_path()
        .map_err(|error| format!("that location cannot be written to: {error}"))?;
    fs::write(&path, &bytes).map_err(|error| format!("could not save {}: {error}", path.display()))?;
    Ok(Some(path.to_string_lossy().to_string()))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            storage_load,
            storage_save,
            storage_path,
            snapshot_write,
            snapshot_list,
            snapshot_read,
            snapshot_prune,
            save_export
        ])
        .run(tauri::generate_context!())
        .expect("Tsek could not start");
}
