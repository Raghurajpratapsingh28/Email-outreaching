import Link from "next/link";
import { CampaignDetail } from "./campaign-detail";

export default async function CampaignDetailPage({
  params,
}: PageProps<"/campaigns/[id]">) {
  const { id } = await params;

  return (
    <div className="flex flex-col gap-4">
      <Link href="/campaigns" className="text-xs text-blue-400 hover:text-blue-300">
        ← Campaigns
      </Link>
      <CampaignDetail campaignId={Number(id)} />
    </div>
  );
}
