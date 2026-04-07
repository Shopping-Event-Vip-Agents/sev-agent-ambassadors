/**
 * Collab Directus client — query ambassador data from collab.shoppingeventvip.be
 */

const COLLAB_URL = process.env.COLLAB_DIRECTUS_URL;
const COLLAB_TOKEN = process.env.COLLAB_DIRECTUS_TOKEN;

async function collabFetch(path: string): Promise<unknown> {
  if (!COLLAB_URL || !COLLAB_TOKEN) {
    throw new Error("COLLAB_DIRECTUS_URL or COLLAB_DIRECTUS_TOKEN not set");
  }
  const res = await fetch(`${COLLAB_URL}${path}`, {
    headers: { Authorization: `Bearer ${COLLAB_TOKEN}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Collab API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

export interface Ambassador {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  instagram_handle: string | null;
  tiktok_handle: string | null;
  status: string;
  country: string | null;
  audience_size: number | null;
  primary_platform: string | null;
  categories: string[] | null;
  avg_views: number | null;
  bio: string | null;
  gender: string | null;
  import_source: string | null;
  notes: string | null;
  last_collaboration_date: string | null;
}

export interface Campaign {
  id: string;
  name: string;
  campaign_type: string;
  status: string;
  content_deadline: string | null;
  incentive_type: string | null;
}

export interface CampaignAmbassador {
  id: string;
  amb_campaign_id: string;
  amb_ambassador_id: string;
  status: string;
}

/** Search ambassadors by name, handle, or email */
export async function searchAmbassadors(query: string, limit = 20): Promise<Ambassador[]> {
  const q = encodeURIComponent(query);
  const filter = `filter[_or][0][first_name][_icontains]=${q}&filter[_or][1][last_name][_icontains]=${q}&filter[_or][2][email][_icontains]=${q}&filter[_or][3][instagram_handle][_icontains]=${q}&filter[_or][4][tiktok_handle][_icontains]=${q}`;
  const res = await collabFetch(`/items/amb_ambassador?${filter}&fields=*&limit=${limit}&sort=-audience_size`) as { data: Ambassador[] };
  return res.data;
}

/** Get ambassadors by status */
export async function getAmbassadorsByStatus(status: string, limit = 50): Promise<Ambassador[]> {
  const res = await collabFetch(`/items/amb_ambassador?filter[status][_eq]=${status}&fields=*&limit=${limit}&sort=-audience_size`) as { data: Ambassador[] };
  return res.data;
}

/** Get ambassador count by status */
export async function getAmbassadorStats(): Promise<Record<string, number>> {
  const statuses = ["lead", "contacted", "negotiating", "active", "inactive"];
  const counts: Record<string, number> = {};
  for (const s of statuses) {
    const res = await collabFetch(`/items/amb_ambassador?filter[status][_eq]=${s}&limit=0&meta=filter_count`) as { meta: { filter_count: number } };
    counts[s] = res.meta.filter_count;
  }
  return counts;
}

/** Get all campaigns */
export async function getCampaigns(): Promise<Campaign[]> {
  const res = await collabFetch("/items/amb_campaign?fields=*&sort=-content_deadline&limit=50") as { data: Campaign[] };
  return res.data;
}

/** Get ambassadors linked to a campaign (by campaign ID or name search) */
export async function getAmbassadorsForCampaign(campaignNameOrId: string): Promise<{ campaign: Campaign; ambassadors: Ambassador[] }> {
  // Try to find campaign by name
  const q = encodeURIComponent(campaignNameOrId);
  let campaigns = (await collabFetch(`/items/amb_campaign?filter[name][_icontains]=${q}&fields=*&limit=5`) as { data: Campaign[] }).data;

  if (campaigns.length === 0) {
    // Try by ID
    try {
      const res = await collabFetch(`/items/amb_campaign/${campaignNameOrId}?fields=*`) as { data: Campaign };
      campaigns = [res.data];
    } catch {
      return { campaign: { id: "", name: campaignNameOrId, campaign_type: "", status: "not found", content_deadline: null, incentive_type: null }, ambassadors: [] };
    }
  }

  const campaign = campaigns[0];
  // Get junction records
  const junctions = (await collabFetch(`/items/amb_campaign_ambassador?filter[amb_campaign_id][_eq]=${campaign.id}&fields=amb_ambassador_id&limit=200`) as { data: CampaignAmbassador[] }).data;

  if (junctions.length === 0) return { campaign, ambassadors: [] };

  const ambIds = junctions.map(j => j.amb_ambassador_id);
  const idFilter = ambIds.map((id, i) => `filter[id][_in][${i}]=${id}`).join("&");
  const ambassadors = (await collabFetch(`/items/amb_ambassador?${idFilter}&fields=*&limit=200`) as { data: Ambassador[] }).data;

  return { campaign, ambassadors };
}

/** Get all campaigns an ambassador has been linked to */
export async function getCampaignsForAmbassador(ambassadorId: string): Promise<{ ambassador: Ambassador; campaigns: Campaign[] }> {
  const ambassador = (await collabFetch(`/items/amb_ambassador/${ambassadorId}?fields=*`) as { data: Ambassador }).data;
  const junctions = (await collabFetch(`/items/amb_campaign_ambassador?filter[amb_ambassador_id][_eq]=${ambassadorId}&fields=amb_campaign_id&limit=50`) as { data: CampaignAmbassador[] }).data;

  if (junctions.length === 0) return { ambassador, campaigns: [] };

  const campIds = junctions.map(j => j.amb_campaign_id);
  const idFilter = campIds.map((id, i) => `filter[id][_in][${i}]=${id}`).join("&");
  const campaigns = (await collabFetch(`/items/amb_campaign?${idFilter}&fields=*&limit=50`) as { data: Campaign[] }).data;

  return { ambassador, campaigns };
}

/** Find ambassadors who have been in multiple campaigns */
export async function getRepeatCollaborators(): Promise<Array<{ ambassador: Ambassador; campaignCount: number; campaignNames: string[] }>> {
  // Get all campaign-ambassador links
  const allLinks = (await collabFetch("/items/amb_campaign_ambassador?fields=amb_ambassador_id,amb_campaign_id&limit=2000") as { data: CampaignAmbassador[] }).data;

  // Count campaigns per ambassador
  const countMap = new Map<string, Set<string>>();
  for (const link of allLinks) {
    if (!countMap.has(link.amb_ambassador_id)) countMap.set(link.amb_ambassador_id, new Set());
    countMap.get(link.amb_ambassador_id)!.add(link.amb_campaign_id);
  }

  // Filter to those with 2+
  const repeats = [...countMap.entries()].filter(([, camps]) => camps.size >= 2);
  if (repeats.length === 0) return [];

  // Fetch ambassador details
  const ambIds = repeats.map(([id]) => id);
  const idFilter = ambIds.map((id, i) => `filter[id][_in][${i}]=${id}`).join("&");
  const ambassadors = (await collabFetch(`/items/amb_ambassador?${idFilter}&fields=*&limit=100`) as { data: Ambassador[] }).data;
  const ambMap = new Map(ambassadors.map(a => [a.id, a]));

  // Fetch campaign names
  const allCampIds = new Set(allLinks.map(l => l.amb_campaign_id));
  const campFilter = [...allCampIds].map((id, i) => `filter[id][_in][${i}]=${id}`).join("&");
  const campaigns = (await collabFetch(`/items/amb_campaign?${campFilter}&fields=id,name&limit=100`) as { data: Campaign[] }).data;
  const campMap = new Map(campaigns.map(c => [c.id, c.name]));

  return repeats
    .map(([ambId, campIds]) => ({
      ambassador: ambMap.get(ambId)!,
      campaignCount: campIds.size,
      campaignNames: [...campIds].map(id => campMap.get(id) || id),
    }))
    .filter(r => r.ambassador)
    .sort((a, b) => b.campaignCount - a.campaignCount);
}

/** Get top ambassadors by audience size */
export async function getTopAmbassadors(limit = 20, platform?: string): Promise<Ambassador[]> {
  let filter = "filter[audience_size][_nnull]=true";
  if (platform) filter += `&filter[primary_platform][_eq]=${platform}`;
  const res = await collabFetch(`/items/amb_ambassador?${filter}&fields=*&sort=-audience_size&limit=${limit}`) as { data: Ambassador[] };
  return res.data;
}

/** Get ambassadors by country */
export async function getAmbassadorsByCountry(countryId: string, limit = 50): Promise<Ambassador[]> {
  const res = await collabFetch(`/items/amb_ambassador?filter[country][_eq]=${countryId}&fields=*&sort=-audience_size&limit=${limit}`) as { data: Ambassador[] };
  return res.data;
}
