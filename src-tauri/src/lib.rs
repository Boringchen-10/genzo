mod anime_details;
mod android_probe;
mod android_bridge;
mod android_sources;
mod android_player;
mod android_events;
mod anime_parser;
mod bangumi;
mod bangumi_network;
mod book_metadata;
mod book_scrape;
mod bookshelf;
mod comic_explore;
mod comic_home;
mod novel_explore;
mod book_content;
mod android_reader;
mod reading_network;
mod comic_cover_cache;
mod commands;
mod credentials;
mod db;
mod error;
mod explore;
mod episode_artwork;
mod film_tv;
mod tmdb_artwork;
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
        .plugin(android_bridge::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            android_events::init(app.handle());
            let state = tauri::async_runtime::block_on(db::initialize(app.handle()))
                .map_err(|error| format!("Genzo 无法初始化本地数据库。{error}"))?;
            tauri::async_runtime::block_on(bangumi_network::initialize(&state.pool))
                .map_err(|error| format!("Genzo 无法读取 Bangumi 网络设置。{error}"))?;
            db::allow_cached_images(app.handle(), &state.cover_cache_path)?;
            db::allow_cached_images(app.handle(), &state.thumbnail_cache_path)?;
            let metadata_pool = state.pool.clone();
            let reading_pool = state.pool.clone();
            tauri::async_runtime::spawn(reading_network::auto_update(reading_pool));
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
            android_probe::android_probe,
            android_bridge::android_native,
            android_sources::authorize_video_source,
            android_sources::get_video_source_states,
            android_sources::scan_video_source,
            comic_cover_cache::cache_comic_explore_cover,
            comic_explore::list_comic_explore,
            comic_home::get_comic_explore_home,
            comic_home::list_comic_explore_section,
            novel_explore::list_novel_explore,
            novel_explore::get_novel_explore_themes,
            novel_explore::get_novel_explore_detail,
            novel_explore::save_novel_explore_work,
            book_content::get_book_source_entries,
            book_content::get_book_reading_source,
            book_content::list_cached_book_content,
            book_content::cache_book_source_content,
            book_content::open_cached_book_content,
            book_content::clear_cached_book_content,
            book_content::get_book_online_content,
            book_content::get_book_online_image,
            reading_network::get_reading_network,
            reading_network::save_reading_network,
            reading_network::fill_reading_network,
            reading_network::test_reading_network,
            bangumi_network::get_bangumi_network,
            bangumi_network::save_bangumi_network,
            bangumi_network::test_bangumi_network,
            comic_explore::get_comic_explore_themes,
            comic_explore::get_comic_explore_detail,
            comic_explore::save_comic_explore_work,
            comic_explore::get_comic_explore_comments,
            novel_explore::get_novel_explore_comments,
            book_scrape::search_book_candidates,
            book_scrape::search_book_import_candidates,
            book_scrape::confirm_book_candidate,
            book_scrape::refresh_book_metadata,
            book_scrape::search_book_volume_candidates,
            book_scrape::confirm_book_volume_candidate,
            book_scrape::clear_book_volume_candidate,
            book_scrape::preview_book_volume_batch,
            book_scrape::confirm_book_volume_batch,
            book_metadata::get_embedded_book_metadata,
            bookshelf::list_book_entries,
            bookshelf::get_book_entry_order,
            bookshelf::save_book_entry_order,
            bookshelf::remove_book_entries,
            bookshelf::save_book_entry,
            bookshelf::save_book_read_state,
            bookshelf::open_book_entry,
            bookshelf::list_book_import_groups,
            bookshelf::create_book_work,
            episode_artwork::get_episode_artwork,
            episode_artwork::search_episode_artwork_sources,
            episode_artwork::list_episode_artwork_seasons,
            episode_artwork::refresh_episode_artwork,
            episode_artwork::preview_episode_artwork_source,
            episode_artwork::set_episode_artwork_source,
            episode_artwork::cache_episode_artwork,
            recognition_preferences::list_recognition_preferences,
            recognition_preferences::forget_recognition_preference,
            recognition_preferences::inspect_media_correction,
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
            commands::set_root_destination,
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
            android_player::open_internal_player,
            android_reader::open_internal_reader,
            android_reader::get_reading_resume,
            android_reader::open_reader_online_fixture,
            android_player::get_internal_player_state,
            android_player::control_internal_player,
            android_player::pick_external_subtitle,
            android_player::list_subtitle_candidates,
            android_player::set_android_appearance,
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
            commands::get_bangumi_subject_structure,
            commands::get_bangumi_subject_comments,
            commands::refresh_work_metadata,
            commands::set_media_episode,
            commands::get_media_thumbnail,
            commands::get_anime_ranking,
            commands::get_anime_popular,
            window_style::window_material_supported,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Genzo");
}
