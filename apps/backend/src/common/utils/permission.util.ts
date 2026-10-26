/** 团队级角色 */
export type TeamRole = 'owner' | 'admin' | 'editor' | 'viewer';
/** 文档级角色(细粒度覆盖) */
export type DocRole = 'editor' | 'viewer';
/** 动作等级 */
export type PermAction = 'read' | 'write' | 'manage';

export const TEAM_ROLE_RANK: Record<TeamRole, number> = {
  viewer: 1,
  editor: 2,
  admin: 3,
  owner: 4,
};

export const DOC_ROLE_RANK: Record<DocRole, number> = { viewer: 1, editor: 2 };

export const ACTION_RANK: Record<PermAction, number> = {
  read: 1,
  write: 2,
  manage: 3,
};

export const ACTION_MIN_TEAM_ROLE: Record<PermAction, TeamRole> = {
  read: 'viewer',
  write: 'editor',
  manage: 'admin',
};

/**
 * 计算"团队角色 + 文档级覆盖"合并后的最高动作等级。
 * 返回 null 表示对文档无任何权限。
 */
export function effectiveDocAction(
  teamRole: TeamRole | null,
  docRole: DocRole | null,
): PermAction | null {
  const teamAction: PermAction | null = teamRole
    ? (['manage', 'write', 'read'] as PermAction[]).find(
        (a) => TEAM_ROLE_RANK[teamRole] >= TEAM_ROLE_RANK[ACTION_MIN_TEAM_ROLE[a]],
      )!
    : null;
  const docAction: PermAction | null = docRole
    ? docRole === 'editor'
      ? 'write'
      : 'read'
    : null;
  const candidates = [teamAction, docAction].filter(Boolean) as PermAction[];
  if (!candidates.length) return null;
  return candidates.reduce(
    (best, a) => (ACTION_RANK[a] > ACTION_RANK[best] ? a : best),
    'read' as PermAction,
  );
}

export function actionSatisfies(has: PermAction, need: PermAction): boolean {
  return ACTION_RANK[has] >= ACTION_RANK[need];
}
