//! Plinth desktop: the web app in a native window, plus an agent folder.
//!
//! The agent folder is the one thing a browser can't do: after every change the app writes its audit
//! (the same file as "Back up") to a folder the person chose, so a local AI agent's MCP server can read it.
//! The folder is chosen in a native dialog and kept here, so the web view can only ever write that one file.

use std::{fs, path::PathBuf, sync::Mutex};
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;

const FILE_NAME: &str = "plinth-audit.json";
const MAX_BYTES: usize = 64 * 1024 * 1024;

#[derive(Default)]
struct AgentFolder(Mutex<Option<PathBuf>>);

fn settings_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join("agent-folder.txt"))
}

fn remember(app: &tauri::AppHandle, folder: Option<&PathBuf>) {
    if let Some(path) = settings_path(app) {
        let _ = fs::create_dir_all(path.parent().unwrap_or(&path));
        let _ = match folder {
            Some(f) => fs::write(&path, f.to_string_lossy().as_bytes()),
            None => fs::remove_file(&path),
        };
    }
}

/// The agent file's full path, if a folder is chosen.
#[tauri::command]
fn agent_file(state: State<AgentFolder>) -> Option<String> {
    state.0.lock().ok()?.as_ref().map(|f| f.join(FILE_NAME).to_string_lossy().into_owned())
}

/// Asks for a folder in a native dialog. Returns the agent file's path, or nothing if cancelled.
#[tauri::command]
fn pick_agent_folder(app: tauri::AppHandle, state: State<AgentFolder>) -> Option<String> {
    let picked = app.dialog().file().set_title("Choose a folder for your AI agent").blocking_pick_folder()?;
    let folder = picked.into_path().ok()?;
    remember(&app, Some(&folder));
    let file = folder.join(FILE_NAME).to_string_lossy().into_owned();
    *state.0.lock().ok()? = Some(folder);
    Some(file)
}

#[tauri::command]
fn clear_agent_folder(app: tauri::AppHandle, state: State<AgentFolder>) {
    remember(&app, None);
    if let Ok(mut f) = state.0.lock() {
        *f = None;
    }
}

/// Writes the audit to the chosen folder. Only a Plinth backup is accepted, and it is written to a
/// temporary file first, then renamed, so a reader never sees half a file.
#[tauri::command]
fn write_agent_file(json: String, state: State<AgentFolder>) -> Result<String, String> {
    let folder = state.0.lock().map_err(|_| "busy".to_string())?.clone().ok_or("Choose an agent folder first")?;
    if json.len() > MAX_BYTES {
        return Err("The audit is too large to write".into());
    }
    let value: serde_json::Value = serde_json::from_str(&json).map_err(|_| "That isn't a Plinth audit".to_string())?;
    if value.get("format").and_then(|f| f.as_str()) != Some("discount-audit") {
        return Err("That isn't a Plinth audit".into());
    }
    let target = folder.join(FILE_NAME);
    let temp = folder.join(format!(".{FILE_NAME}.tmp"));
    fs::write(&temp, json.as_bytes()).map_err(|e| format!("Plinth couldn't write to {}: {e}", folder.display()))?;
    fs::rename(&temp, &target).map_err(|e| format!("Plinth couldn't write to {}: {e}", folder.display()))?;
    Ok(target.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AgentFolder::default())
        .setup(|app| {
            // Restore the folder chosen last time, if it still exists.
            if let Some(path) = settings_path(app.handle()) {
                if let Ok(saved) = fs::read_to_string(path) {
                    let folder = PathBuf::from(saved.trim());
                    if folder.is_dir() {
                        *app.state::<AgentFolder>().0.lock().unwrap() = Some(folder);
                    }
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![agent_file, pick_agent_folder, clear_agent_folder, write_agent_file])
        .run(tauri::generate_context!())
        .expect("Plinth couldn't start");
}
