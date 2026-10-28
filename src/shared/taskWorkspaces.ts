export interface TaskWorkspace {
  id: string;
  name: string;
  branch: string;
  path: string;
  note: string;
}

export interface TaskWorkspaceCreate {
  name: string;
  branch: string;
  path: string;
}
