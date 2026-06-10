import { NextResponse } from "next/server";
import { jsonError, requireUser } from "@/lib/auth";
import { createBatchGeneration } from "@/lib/create-batch";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const tasks = await createBatchGeneration(user, await request.json());
    return NextResponse.json({ success: true, tasks });
  } catch (error) {
    return jsonError(error);
  }
}
