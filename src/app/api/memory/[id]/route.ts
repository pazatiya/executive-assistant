import { apiContext, ok } from "@/lib/api";
import { deleteMemory } from "@/lib/services/memory";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user } = await apiContext();
  const { id } = await params;
  await deleteMemory(user.id, id);
  return ok({ deleted: id });
}
