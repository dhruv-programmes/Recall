import { Suspense } from "react";
import { MeetingScreen } from "@/components/meetings/meeting-screen";

export default function MeetingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense
      fallback={
        <p className="px-8 py-8 text-sm text-muted-foreground">Loading meeting…</p>
      }
    >
      <ResolvedMeeting params={params} />
    </Suspense>
  );
}

async function ResolvedMeeting({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <MeetingScreen meetingId={id} />;
}
