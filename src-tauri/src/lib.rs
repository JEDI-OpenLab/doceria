// Coquille native Doceria (Tauri v2).
// Enregistre les commandes réseau ILaaS et l'état partagé (jeton d'annulation du chat).
// Fenêtre native : fermer = quitter (y compris macOS).

mod ilaas;
mod keychain;
mod rag;
mod settings;
mod update;

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
      rag::rag_upload_text,
      rag::rag_ocr,
      rag::read_file,
      rag::rag_get_document,
      rag::rag_delete_document,
      rag::rag_list_documents,
      rag::rag_search,
      rag::rag_rerank,
      rag::list_dir_files,
      rag::list_dir_entries,
      rag::fetch_usage,
      update::check_update,
      update::open_url
    ])
    .on_window_event(|window, event| {
      // Fermer la fenêtre arrête toute l'application (cf. SPEC : « fermer = quitter »).
      if let WindowEvent::CloseRequested { .. } = event {
        window.app_handle().exit(0);
      }
    })
    .setup(|app| {
      // Menu natif explicite. Tauri v2 n'ajoute PAS de menu par défaut : sans lui, les
      // raccourcis d'édition de la webview (⌘C/⌘V/⌘A…) et Quitter ne fonctionnent pas.
      // On n'utilise que des items prédéfinis (libellés localisés par l'OS).
      {
        use tauri::menu::{Menu, PredefinedMenuItem, Submenu};
        let h = app.handle().clone();
        let app_menu = Submenu::with_items(
          &h,
          "Doceria",
          true,
          &[
            &PredefinedMenuItem::about(&h, None, None)?,
            &PredefinedMenuItem::separator(&h)?,
            &PredefinedMenuItem::hide(&h, None)?,
            &PredefinedMenuItem::separator(&h)?,
            &PredefinedMenuItem::quit(&h, None)?,
          ],
        )?;
        let edit_menu = Submenu::with_items(
          &h,
          "Édition",
          true,
          &[
            &PredefinedMenuItem::undo(&h, None)?,
            &PredefinedMenuItem::redo(&h, None)?,
            &PredefinedMenuItem::separator(&h)?,
            &PredefinedMenuItem::cut(&h, None)?,
            &PredefinedMenuItem::copy(&h, None)?,
            &PredefinedMenuItem::paste(&h, None)?,
            &PredefinedMenuItem::select_all(&h, None)?,
          ],
        )?;
        let window_menu = Submenu::with_items(
          &h,
          "Fenêtre",
          true,
          &[
            &PredefinedMenuItem::minimize(&h, None)?,
            &PredefinedMenuItem::fullscreen(&h, None)?,
            &PredefinedMenuItem::separator(&h)?,
            &PredefinedMenuItem::close_window(&h, None)?,
          ],
        )?;
        let menu = Menu::with_items(&h, &[&app_menu, &edit_menu, &window_menu])?;
        app.set_menu(menu)?;
      }

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
