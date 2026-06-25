// Coquille native Doceria (Tauri v2).
// Enregistre les commandes réseau ILaaS et l'état partagé (jeton d'annulation du chat).
// Fenêtre native : fermer = quitter (y compris macOS).

mod ilaas;
mod keychain;
mod rag;
mod settings;

use ilaas::ChatState;
use tauri::{Manager, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_window_state::Builder::default().build())
    .manage(ChatState::default())
    .invoke_handler(tauri::generate_handler![
      ilaas::list_models,
      ilaas::chat,
      ilaas::cancel_chat,
      ilaas::test_connection,
      ilaas::test_connection_ephemeral,
      keychain::set_profile_key,
      settings::list_profiles,
      settings::upsert_profile,
      settings::delete_profile,
      settings::set_active_profile,
      rag::rag_me,
      rag::rag_list_collections,
      rag::rag_create_collection,
      rag::rag_delete_collection,
      rag::rag_upload_document,
      rag::rag_get_document,
      rag::rag_delete_document,
      rag::rag_search,
      rag::rag_rerank,
      rag::list_dir_files,
      rag::list_dir_entries
    ])
    .on_window_event(|window, event| {
      // Fermer la fenêtre arrête toute l'application (cf. SPEC : « fermer = quitter »).
      if let WindowEvent::CloseRequested { .. } = event {
        window.app_handle().exit(0);
      }
    })
    .setup(|app| {
      // Charge les profils (métadonnées non sensibles) depuis le dossier de données.
      let loaded = settings::load(app.handle());
      app.manage(settings::SettingsState(std::sync::Mutex::new(loaded)));
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
