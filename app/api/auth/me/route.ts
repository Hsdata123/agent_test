import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getRole } from "@/lib/roles";

export async function GET() {
  const user = await getCurrentUser();
  const role = user ? await getRole(user.role) : null;
  return NextResponse.json({
    success: true,
    user: user
      ? {
          id: user.id,
          username: user.username,
          nickname: user.nickname,
          role: user.role,
          status: user.status,
          permissions: role?.permissions || []
        }
      : null
  });
}
