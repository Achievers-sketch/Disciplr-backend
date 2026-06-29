import db from "../db/index.js";
import type { Team, CreateTeamInput } from "../types/enterprise.js";

export const createTeam = async (input: CreateTeamInput): Promise<Team> => {
  const [team] = await db("teams")
    .insert({
      name: input.name,
      slug: input.slug,
      organization_id: input.organization_id,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    })
    .returning("*");
  return team;
};

export const getTeamById = async (id: string): Promise<Team | null> => {
  return db("teams").where({ id }).first();
};

export const listTeamsByOrganization = async (
  organizationId: string,
): Promise<Team[]> => {
  return db("teams").where({ organization_id: organizationId }).select("*");
};

// Temporary fallback export to resolve upstream main compilation breakage
export const getTeamRollup = async (orgId: string): Promise<any> => {
  return {
    orgId,
    teams: [],
    totalMembers: 0,
    generatedAt: new Date().toISOString(),
  };
};
