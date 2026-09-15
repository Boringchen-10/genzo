mod anime_parser;
mod bangumi;
mod commands;
mod db;
mod error;
mod explore;
mod grouping;
mod launcher;
mod media_mapping;
mod metadata;
mod metadata_aggregator;
mod metadata_provider;
mod models;
mod providers;
mod scanner;
mod window_style;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let state = tauri::async_runtime::block_on(db::initialize(app.handle()))
                .map_err(|error| format!("Genzo 无法初始化本地数据库。{error}"))?;
            db::allow_cached_covers(app.handle(), &state.cover_cache_path)?;
            let metadata_pool = state.pool.clone();
            app.manage(state);
            tauri::async_runtime::spawn_blocking(|| {
                if let Err(error) = explore::warm_embedded_index() {
                    eprintln!("{error}");
                }
            });
            tauri::async_runtime::spawn(async move {
                if let Err(error) = explore::check_bangumi_data_update(&metadata_pool).await {
                    eprintln!("{error}");
                }
            });
            if let Some(window) = app.get_webview_window("main") {
                window_style::apply(&window);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_works,
            commands::get_work,
            commands::create_work,
            commands::create_work_from_media,
            commands::update_work,
            commands::delete_work,
            commands::list_unassigned_media,
            commands::list_unassigned_media_groups,
            commands::attach_media_file,
            commands::detach_media_file,
            commands::import_cover,
            commands::list_library_roots,
            commands::add_library_root,
            commands::update_library_root,
            commands::delete_library_root,
            commands::scan_library_root,
            commands::list_scan_jobs,
            commands::list_external_tools,
            commands::create_external_tool,
            commands::update_external_tool,
            commands::delete_external_tool,
            commands::detect_external_tools,
            commands::test_external_tool,
            commands::launch_media,
            commands::open_media_directory,
            commands::get_dashboard,
            commands::get_app_info,
            commands::open_data_directory,
            commands::get_setting,
            commands::set_setting,
            commands::recognize_media_file,
            commands::recognize_unmatched_media,
            commands::list_match_candidates,
            commands::confirm_match_candidate,
            commands::cancel_match_candidates,
            commands::set_work_field_lock,
            commands::get_explore_overview,
            commands::search_explore_subjects,
            commands::get_explore_subject,
            commands::save_explore_subject,
            commands::get_discovery_list,
            commands::get_weekly_calendar,
            commands::check_in_local_library,
            commands::get_metadata_provider_statuses,
            commands::list_anime_episodes,
            window_style::window_material_supported,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Genzo");
}
