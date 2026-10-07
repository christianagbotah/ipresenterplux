export const PLANNER_SERVICE_STATUSES = ["draft", "ready", "live", "ended", "archived"] as const;
export type PlannerServiceStatus = (typeof PLANNER_SERVICE_STATUSES)[number];

export const PLANNER_ITEM_TYPES = [
  "scripture",
  "song",
  "slide",
  "media",
  "announcement",
  "lower_third",
  "camera",
  "custom"
] as const;
export type PlannerItemType = (typeof PLANNER_ITEM_TYPES)[number];

export const PLANNER_MAX_ITEMS = 200;
export const PLANNER_MAX_SONG_SECTIONS = 64;
export const PLANNER_BODY_MAX = 12000;
export const PLANNER_FOOTER_MAX = 500;

export type PlannerRevisionItem = {
  id: string;
  itemType: PlannerItemType | string;
  sortOrder: number;
  state: string;
  updatedAt: string;
};

export type PlannerRevisionSource = {
  serviceId: string;
  serviceUpdatedAt: string;
  items: readonly PlannerRevisionItem[];
};
