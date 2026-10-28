export type DashboardContextMenuActionModel = {
  disabled?: boolean;
  hidden?: boolean;
};

export type DashboardContextMenuGroupModel<
  TAction extends DashboardContextMenuActionModel,
> = {
  actions: TAction[];
};

export function getVisibleDashboardMenuGroups<
  TAction extends DashboardContextMenuActionModel,
  TGroup extends DashboardContextMenuGroupModel<TAction>,
>(groups: TGroup[]): TGroup[] {
  return groups
    .map((group) => ({
      ...group,
      actions: group.actions.filter((action) => !action.hidden),
    }))
    .filter((group) => group.actions.length > 0);
}
