mod anime_details;
mod anime_parser;
mod bangumi;
mod commands;
mod credentials;
mod db;
mod error;
mod explore;
mod episode_artwork;
mod film_tv;
mod grouping;
mod launcher;
mod library_maintenance;
mod playback;
#[cfg(windows)]
mod potplayer;
mod media_mapping;
mod media_reconciliation;
mod metadata;
mod metadata_aggregator;
mod metadata_provider;
mod migration_compat;
mod models;
mod providers;
mod recognition_history;
mod recognition_preferences;
mod remote_storage;
#[cfg(all(test, windows))]
mod remote_storage_tests;
mod remote_transfer;
mod scanner;
mod scan_tasks;
mod thumbnail;
mod webdav;
mod window_style;
mod work_category;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let state = tauri::async_runtime::block_on(db::initialize(app.handle()))
                .map_err(|error| format!("Genzo 无法初始化本地数据库。{error}"))?;
            db::allow_cached_images(app.handle(), &state.cover_cache_path)?;
            db::allow_cached_images(app.handle(), &state.thumbnail_cache_path)?;
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
            episode_artwork::get_episode_artwork,
            episode_artwork::refresh_episode_artwork,
            episode_artwork::preview_episode_artwork_source,
            episode_artwork::set_episode_artwork_source,
            episode_artwork::cache_episode_artwork,
            recognition_preferences::list_recognition_preferences,
            recognition_preferences::forget_recognition_preference,
            recognition_preferences::preview_media_correction,
            recognition_preferences::apply_media_correction,
            library_maintenance::inspect_library,
            library_maintenance::list_relocation_files,
            library_maintenance::preview_media_relocation,
            library_maintenance::apply_media_relocation,
            remote_storage::list_remote_sources,
            remote_storage::browse_webdav,
            remote_storage::add_webdav_source,
            remote_storage::update_webdav_credentials,
            remote_storage::set_root_source_type,
            remote_transfer::list_remote_cache,
            remote_transfer::cache_remote_media,
            remote_transfer::remove_remote_cache,
            remote_transfer::set_cache_limit,
            commands::list_works,
            commands::get_work,
            commands::create_work,
            commands::create_work_from_media,
            commands::update_work,
            commands::delete_work,
            commands::list_unassigned_media,
            commands::list_unassigned_media_groups,
            commands::list_recognition_group_members,
            commands::attach_media_file,
            commands::attach_media_files,
            commands::detach_media_file,
            commands::import_cover,
            commands::list_library_roots,
            commands::add_library_root,
            commands::update_library_root,
            commands::delete_library_root,
            commands::scan_library_root,
            commands::list_scan_jobs,
            scan_tasks::list_scan_tasks,
            scan_tasks::cancel_scan_task,
            scan_tasks::retry_scan_task,
            commands::list_external_tools,
            commands::create_external_tool,
            commands::update_external_tool,
            commands::delete_external_tool,
            commands::detect_external_tools,
            commands::test_external_tool,
            commands::launch_media,
            playback::get_playback_progress,
            playback::resume_playback,
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
            commands::list_recognition_history,
            commands::undo_recognition,
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
            commands::get_anime_work_structure,
            commands::refresh_work_metadata,
            commands::set_media_episode,
            commands::get_media_thumbnail,
            commands::get_anime_ranking,
            window_style::window_material_supported,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Genzo");
}
