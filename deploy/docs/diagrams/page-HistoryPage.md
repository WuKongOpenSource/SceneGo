# Vertical Slice: HistoryPage

**Files**: deploy/new_html/components/HistoryPage.tsx, deploy/new_html/pages/HistoryPage.tsx, new_html/components/HistoryPage.tsx, new_html/pages/HistoryPage.tsx

**Tables**: -

```mermaid
flowchart LR
  classDef fe fill:#e3f2fd,stroke:#1976d2,color:#0d47a1;
  classDef be fill:#fff3e0,stroke:#f57c00,color:#e65100;
  classDef db fill:#e8f5e9,stroke:#388e3c,color:#1b5e20;
  classDef ch fill:#f3e5f5,stroke:#7b1fa2,color:#4a148c;

  subgraph FE["Frontend - HistoryPage"]
    fe_deploy_new_html_components_HistoryPage_tsx["HistoryPage.tsx"]:::fe
    fe_deploy_new_html_pages_HistoryPage_tsx["HistoryPage.tsx"]:::fe
    fe_new_html_components_HistoryPage_tsx["HistoryPage.tsx"]:::fe
  end


  subgraph CH["Cross-page channels"]
    ch_storage_auth_token(("storage:auth_token")):::ch
  end
  fe_deploy_new_html_components_HistoryPage_tsx -.-> ch_storage_auth_token
```
