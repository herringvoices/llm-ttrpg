use tauri_plugin_sql::{Migration, MigrationKind};

const DATABASE_URL: &str = "sqlite:llm-ttrpg.db";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![Migration {
        version: 1,
        description: "persistence_foundation",
        sql: include_str!("../migrations/0001_persistence_foundation.sql"),
        kind: MigrationKind::Up,
    }, Migration {
        version: 2,
        description: "fictional_time_event_history",
        sql: include_str!("../migrations/0002_fictional_time_event_history.sql"),
        kind: MigrationKind::Up,
    }, Migration {
        version: 3,
        description: "action_pressure",
        sql: include_str!("../migrations/0003_action_pressure.sql"),
        kind: MigrationKind::Up,
    }, Migration {
        version: 4,
        description: "resolution_randomness",
        sql: include_str!("../migrations/0004_resolution_randomness.sql"),
        kind: MigrationKind::Up,
    }, Migration {
        version: 5,
        description: "player_action_runs",
        sql: include_str!("../migrations/0005_player_action_runs.sql"),
        kind: MigrationKind::Up,
    }, Migration {
        version: 6,
        description: "social_realization_generation",
        sql: include_str!("../migrations/0006_social_realization_generation.sql"),
        kind: MigrationKind::Up,
    }, Migration {
        version: 7,
        description: "campaign_planning",
        sql: include_str!("../migrations/0007_campaign_planning.sql"),
        kind: MigrationKind::Up,
    }, Migration {
        version: 8,
        description: "playable_loop",
        sql: include_str!("../migrations/0008_playable_loop.sql"),
        kind: MigrationKind::Up,
    }];

    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DATABASE_URL, migrations)
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("error while running desktop application");
}
