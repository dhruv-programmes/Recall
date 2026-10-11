import { ApiError, api } from "@/lib/client";
import { createClient } from "@/lib/supabase/client";
import { extensionForUpload } from "@/lib/storage/paths";
import type { MeetingDetail, MeetingSource } from "@/lib/types";

const MAX_BYTES = 200 * 1024 * 1024;

export async function saveAudioMeeting(input: {
  file: File;
  source: MeetingSource;
  title?: string;
}) {
  if (input.file.size <= 0) {
    throw new ApiError("That file is empty.");
  }
  if (input.file.size > MAX_BYTES) {
    throw new ApiError(`That file is larger than ${Math.round(MAX_BYTES / (1024 * 1024))} MB.`);
  }
  const extension = extensionForUpload(input.file.name, input.file.type);
  if (!extension) {
    throw new ApiError("Use an audio file such as mp3, wav, m4a, webm, or ogg.");
  }
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) throw new ApiError("Sign in to continue.");
  const id = crypto.randomUUID();
  const audioPath = `${userId}/${id}${extension}`;
  const audioMime = input.file.type || "application/octet-stream";
  const uploaded = await supabase.storage.from("meeting-audio").upload(audioPath, input.file, {
    contentType: audioMime,
    upsert: false,
  });
  if (uploaded.error) throw new ApiError(uploaded.error.message);
  try {
    return await api<MeetingDetail>("/api/meetings", {
      method: "POST",
      body: JSON.stringify({
        id,
        title: input.title?.trim() ?? "",
        source: input.source,
        audioPath,
        audioMime,
      }),
    });
  } catch (error) {
    await supabase.storage.from("meeting-audio").remove([audioPath]);
    throw error;
  }
}
