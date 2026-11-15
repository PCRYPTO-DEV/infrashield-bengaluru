# MiroFish backend API reference

Source: github.com/666ghj/MiroFish, commit `7657031` (2026-10-02). Base URL: `http://localhost:5001`.
Every response is `{"success": bool, "data": {...}}` or `{"success": false, "error": "..."}`.
Long steps return a `task_id` that you poll until `status` is `completed` or `failed`
(task fields: `status`, `progress`, `message`, `result`, `error`).

## Pipeline (in order)

| # | Call | Body / params | Returns |
|---|---|---|---|
| 1 | `POST /api/graph/ontology/generate` (multipart) | `files` (repeat; pdf/md/markdown/txt, ≤50 MB), `simulation_requirement` (required), `project_name`, `additional_context` | `project_id`, `ontology{entity_types, edge_types, analysis_summary}` |
| 2 | `POST /api/graph/build` | `project_id`, opt. `graph_name`, `chunk_size` (500), `chunk_overlap` (50), `force` | `task_id`; poll `GET /api/graph/task/{task_id}` → `result.graph_id`, `node_count`, `edge_count` |
| 3 | `POST /api/simulation/create` | `project_id`, opt. `graph_id`, `enable_twitter` (true), `enable_reddit` (true) | `simulation_id` |
| 4 | `POST /api/simulation/prepare` | `simulation_id`, opt. `entity_types`, `use_llm_for_profiles` (true), `parallel_profile_count` (5), `force_regenerate` | `task_id`, `status` `preparing` or `ready`; poll `POST /api/simulation/prepare/status {task_id, simulation_id}` until `ready` or `completed` |
| 5 | `POST /api/simulation/start` | `simulation_id`, opt. `platform` (`parallel`/`twitter`/`reddit`), `max_rounds`, `enable_graph_memory_update`, `force` | `runner_status`; poll `GET /api/simulation/{id}/run-status` → `runner_status` (`idle`/`starting`/`running`/`paused`/`stopping`/`stopped`/`completed`/`failed`), `current_round`, `total_rounds`, `total_actions_count` |
| 6 | `POST /api/report/generate` | `simulation_id`, opt. `force_regenerate` | `report_id`, `task_id`; poll `POST /api/report/generate/status {task_id, simulation_id}`; then `GET /api/report/{report_id}` → `markdown_content`, `outline` |

## Graph / projects
- `GET /api/graph/project/{id}`, `GET /api/graph/project/list?limit=`, `DELETE /api/graph/project/{id}`, `POST /api/graph/project/{id}/reset`
- `GET /api/graph/data/{graph_id}`: nodes and edges. `DELETE /api/graph/delete/{graph_id}`. `GET /api/graph/tasks`

## Simulation
- Entities: `GET /api/simulation/entities/{graph_id}?entity_types=a,b&enrich=true`, `.../entities/{graph_id}/{uuid}`, `.../entities/{graph_id}/by-type/{type}`
- `GET /api/simulation/{id}`, `GET /api/simulation/list?project_id=`, `GET /api/simulation/history?limit=`
- Profiles and config: `GET /{id}/profiles?platform=`, `/{id}/profiles/realtime`, `/{id}/config`, `/{id}/config/realtime`, `/{id}/config/download`
- Run control: `POST /api/simulation/stop`, `POST /api/simulation/close-env`, `POST /api/simulation/env-status` (all `{simulation_id}`)
- Results: `GET /{id}/run-status/detail?platform=`, `/{id}/actions?limit&offset&platform&agent_id&round_num`, `/{id}/timeline?start_round&end_round`, `/{id}/agent-stats`, `/{id}/posts?platform&limit&offset`, `/{id}/comments?platform&post_id&limit&offset`
- Interviews (environment must be alive):
  - `POST /api/simulation/interview {simulation_id, agent_id, prompt, platform?, timeout=60}`
  - `POST /api/simulation/interview/batch {simulation_id, interviews:[{agent_id, prompt, platform?}], platform?, timeout=120}`
  - `POST /api/simulation/interview/all {simulation_id, prompt, platform?, timeout=180}`
  - `POST /api/simulation/interview/history {simulation_id, platform?, agent_id?, limit=100}`
- `POST /api/simulation/generate-profiles {graph_id, entity_types?, use_llm?, platform?}`: profiles only

## Report
- `GET /api/report/{id}`, `GET /api/report/by-simulation/{sim}`, `GET /api/report/check/{sim}`, `GET /api/report/list`, `GET /api/report/{id}/download`, `DELETE /api/report/{id}`
- Progress and sections: `GET /{id}/progress`, `/{id}/sections`, `/{id}/section/{n}`
- Logs: `GET /{id}/agent-log?from_line=`, `/{id}/console-log?from_line=` (and `/stream` variants)
- `POST /api/report/chat {simulation_id, message, chat_history?:[{role, content}]}` → `response`, `tool_calls`, `sources`
- Tools: `POST /api/report/tools/search {graph_id, query, limit}`, `POST /api/report/tools/statistics {graph_id}`
