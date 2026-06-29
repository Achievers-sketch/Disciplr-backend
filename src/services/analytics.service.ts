import {
  queryVaultStatsByPeriod,
  queryVaultStatusBreakdownAllTime,
  queryVaultStatusBreakdownByPeriod,
  readAnalyticsSummary,
  updateAnalyticsSummary as dbUpdateSummary,
  getTimeRangeFilter,
} from "../db/database.js";
import type {
  VaultAnalytics,
  VaultAnalyticsWithPeriod,
} from "../types/vault.js";
import { utcNow } from "../utils/timestamps.js";
import { getOrSet, invalidate } from "../lib/cache.js";

export async function getOverallAnalytics(): Promise<VaultAnalytics> {
  return getOrSet("analytics:overall", 300, async () => {
    const summary = await readAnalyticsSummary();

    return {
      totalVaults: summary.total_vaults,
      activeVaults: summary.active_vaults,
      completedVaults: summary.completed_vaults,
      failedVaults: summary.failed_vaults,
      totalLockedCapital: summary.total_locked_capital,
      activeCapital: summary.active_capital,
      successRate: summary.success_rate,
      lastUpdated: summary.last_updated,
    };
  });
}

export async function getAnalyticsByPeriod(
  period: string,
): Promise<VaultAnalyticsWithPeriod> {
  const { startDate, endDate } = getTimeRangeFilter(period);

  const stats = await queryVaultStatsByPeriod(startDate, endDate);

  const totalCompleted = stats.completed_vaults || 0;
  const totalFailed = stats.failed_vaults || 0;
  const successRate =
    totalCompleted + totalFailed > 0
      ? (totalCompleted / (totalCompleted + totalFailed)) * 100
      : 0;

  return {
    totalVaults: stats.total_vaults || 0,
    activeVaults: stats.active_vaults || 0,
    completedVaults: stats.completed_vaults || 0,
    failedVaults: stats.failed_vaults || 0,
    totalLockedCapital: (stats.total_locked_capital || 0).toString(),
    activeCapital: (stats.active_capital || 0).toString(),
    successRate: Math.round(successRate * 100) / 100,
    lastUpdated: new Date().toISOString(),
    period,
    startDate,
    endDate,
  };
}

export async function getVaultStatusBreakdown(): Promise<{
  byStatus: Record<string, number>;
  byStatusAndPeriod: Record<string, Record<string, number>>;
}> {
  const allTimeRows = await queryVaultStatusBreakdownAllTime();

  const byStatus: Record<string, number> = {};
  allTimeRows.forEach((row) => {
    byStatus[row.status] = row.count;
  });

  const { startDate, endDate } = getTimeRangeFilter("30d");
  const last30DaysRows = await queryVaultStatusBreakdownByPeriod(
    startDate,
    endDate,
  );

  const byStatusAndPeriod: Record<string, Record<string, number>> = {
    "30d": {},
  };
  last30DaysRows.forEach((row) => {
    byStatusAndPeriod["30d"][row.status] = row.count;
  });

  return { byStatus, byStatusAndPeriod };
}

export async function getCapitalAnalytics(period: string = "all"): Promise<{
  totalLockedCapital: string;
  activeCapital: string;
  averageVaultSize: string;
  period: string;
}> {
  let totalLockedCapital = 0;
  let activeCapital = 0;
  let totalVaults = 0;

  if (period === "all") {
    const stats = await queryVaultStatsByPeriod(
      new Date(0).toISOString(),
      new Date().toISOString(),
    );
    totalLockedCapital = stats.total_locked_capital || 0;
    activeCapital = stats.active_capital || 0;
    totalVaults = stats.total_vaults || 0;
  } else {
    const { startDate, endDate } = getTimeRangeFilter(period);
    const stats = await queryVaultStatsByPeriod(startDate, endDate);
    totalLockedCapital = stats.total_locked_capital || 0;
    activeCapital = stats.active_capital || 0;
    totalVaults = stats.total_vaults || 0;
  }

  const avgSize = totalVaults > 0 ? totalLockedCapital / totalVaults : 0;

  return {
    totalLockedCapital: totalLockedCapital.toString(),
    activeCapital: activeCapital.toString(),
    averageVaultSize: avgSize.toFixed(2),
    period,
  };
}

export async function updateAnalyticsSummary(): Promise<void> {
  await dbUpdateSummary();
  await invalidate("analytics:overall");
}

/**
 * Retrieves monthly vault creation cohort metrics and retention trends
 * from the vault_cohort_retention materialized view.
 * @param {any} db The database knex connection instance passed from the router/service layer
 * @param {number} [range] Optional filter specifying the number of past months to fetch
 */
export async function getCohortRetention(db, range) {
  let query = db("vault_cohort_retention")
    .select(
      "cohort_month",
      "total",
      "completed",
      "failed",
      "active",
      "median_days_to_complete",
    )
    .orderBy("cohort_month", "desc");

  if (range && range > 0) {
    // Limits lookup to the most recent N months dynamically
    query = query.limit(range);
  }

  const rows = await query;

  // Format database responses cleanly for JSON consumption
  return rows.map((row) => ({
    ...row,
    // Ensure JavaScript Date formats remain readable across regions
    cohort_month:
      row.cohort_month instanceof Date
        ? row.cohort_month.toISOString().split("T")[0]
        : row.cohort_month,
    // Convert DB float or null value to a clean round number or default
    median_days_to_complete:
      row.median_days_to_complete !== null
        ? parseFloat(parseFloat(row.median_days_to_complete).toFixed(1))
        : null,
  }));
}
