// Wire types mirroring backend/api/internal/analysis Map (packages/contracts/analysis-map/v1).

export interface TerraMap {
  project: Project;
  components: Component[];
  relationships: Relationship[];
  suggested_questions: string[];
}

export interface Project {
  name: string;
  repository_url: string;
  description: string;
  kind: string;
  primary_languages: string[];
  stats: { approx_source_files: number; top_level_dirs: string[] };
}

export interface Component {
  id: string;
  parent_id: string | null;
  name: string;
  purpose: string;
  importance: "critical" | "high" | "medium" | "low";
  type: "frontend" | "backend" | "database" | "infrastructure" | "mobile" | "desktop";
  tech?: string[];
  files: string[];
  file_count?: number;
}

export interface Relationship {
  from: string;
  to: string;
  type: string;
  because: string[];
}
