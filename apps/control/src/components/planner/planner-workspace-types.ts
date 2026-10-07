export type PlannerWorkspaceService = {
  id: string;
  organizationId: string;
  campusId: string | null;
  campusName: string | null;
  title: string;
  serviceType: string;
  status: string;
  scheduledStart: string | null;
  startedAt: string | null;
  endedAt: string | null;
  activeBibleVersion: string;
  createdAt: string;
  updatedAt: string;
  timezone: string;
  itemCount: number;
  edgeAssignmentCount: number;
};

export type PlannerWorkspaceItem = {
  id: string;
  itemType: string;
  title: string;
  content: Record<string, unknown>;
  sortOrder: number;
  state: string;
  createdAt: string;
  updatedAt: string;
};

export type PlannerReadinessIssue = { code: string; label: string; itemId?: string };
export type PlannerReadiness = { status: string; issues: PlannerReadinessIssue[] };

export type PlannerPresentation = {
  itemType: string;
  title: string;
  body: string;
  footer: string | null;
};

export type PlannerDetailPayload = {
  service: PlannerWorkspaceService;
  items: PlannerWorkspaceItem[];
  readiness: PlannerReadiness;
  revision: string;
  canEdit: boolean;
  edgeAssignment: { count: number };
};
