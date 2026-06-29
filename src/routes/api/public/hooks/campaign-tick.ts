import { createFileRoute } from "@tanstack/react-router";
import { processDueCampaigns } from "@/lib/campaign-dispatch";

export const Route = createFileRoute("/api/public/hooks/campaign-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY!;
        const provided = request.headers.get("apikey") || request.headers.get("Apikey");
        if (!expected || provided !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }
        const result = await processDueCampaigns({ limit: 50 });
        return Response.json(result);
      },
    },
  },
});
