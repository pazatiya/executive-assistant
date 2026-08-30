import { NextResponse } from "next/server";
import { getActiveWorkspaceId, getCurrentUser } from "@/lib/auth";

export async function apiContext(req?: Request) {
  const user = await getCurrentUser();
  let workspaceId: string;
  const url = req ? new URL(req.url) : null;
  const fromQuery = url?.searchParams.get("workspaceId");
  if (fromQuery) workspaceId = fromQuery;
  else workspaceId = await getActiveWorkspaceId(user.id);
  return { user, workspaceId };
}

export function ok(data: unknown, init?: number) {
  return NextResponse.json(data, { status: init ?? 200 });
}

export function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}
