# Vertical Slice: MaterialsPage

**Files**: deploy/new_html/pages/MaterialsPage.tsx, new_html/pages/MaterialsPage.tsx

**Tables**: assets, character_voices, files, notifications, projects, tasks

```mermaid
flowchart LR
  classDef fe fill:#e3f2fd,stroke:#1976d2,color:#0d47a1;
  classDef be fill:#fff3e0,stroke:#f57c00,color:#e65100;
  classDef db fill:#e8f5e9,stroke:#388e3c,color:#1b5e20;
  classDef ch fill:#f3e5f5,stroke:#7b1fa2,color:#4a148c;

  subgraph FE["Frontend - MaterialsPage"]
    fe_deploy_new_html_pages_MaterialsPage_tsx["MaterialsPage.tsx"]:::fe
    fe_new_html_pages_MaterialsPage_tsx["MaterialsPage.tsx"]:::fe
  end

  subgraph BE["Backend"]
    be_POST__api_assets["POST /api/assets\n[create_asset]"]:::be
    be_POST__api_character_voices["POST /api/character-voices\n[create_character_voice]"]:::be
    be_POST__api_materials_doubao["POST /api/materials/doubao\n[generate_doubao_images]"]:::be
    be_POST__api_notifications_read_all["POST /api/notifications/read-all\n[mark_all_notifications_read]"]:::be
    be_POST__api_projects_save["POST /api/projects/save\n[save_project]"]:::be
  end

  subgraph DB["Database"]
    db_assets[("assets")]:::db
    db_character_voices[("character_voices")]:::db
    db_files[("files")]:::db
    db_notifications[("notifications")]:::db
    db_projects[("projects")]:::db
    db_tasks[("tasks")]:::db
  end

  fe_deploy_new_html_pages_MaterialsPage_tsx --> be_POST__api_assets
  fe_deploy_new_html_pages_MaterialsPage_tsx --> be_POST__api_character_voices
  fe_deploy_new_html_pages_MaterialsPage_tsx --> be_POST__api_materials_doubao
  fe_deploy_new_html_pages_MaterialsPage_tsx --> be_POST__api_notifications_read_all
  fe_deploy_new_html_pages_MaterialsPage_tsx --> be_POST__api_projects_save
  be_POST__api_assets --> db_assets
  be_POST__api_character_voices --> db_character_voices
  be_POST__api_materials_doubao --> db_files
  be_POST__api_materials_doubao --> db_tasks
  be_POST__api_notifications_read_all --> db_notifications
  be_POST__api_projects_save --> db_projects

  subgraph CH["Cross-page channels"]
    ch_context_EpisodeContext(("context:EpisodeContext")):::ch
    ch_storage_auth_token(("storage:auth_token")):::ch
    ch_storage_username(("storage:username")):::ch
  end
  fe_deploy_new_html_pages_MaterialsPage_tsx -.-> ch_context_EpisodeContext
  fe_deploy_new_html_pages_MaterialsPage_tsx -.-> ch_storage_auth_token
  fe_deploy_new_html_pages_MaterialsPage_tsx -.-> ch_storage_username
```
