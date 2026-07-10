import { prisma } from "../lib/prisma";

async function main() {
  const users = await prisma.user.findMany({
    where: { advertiserId: { not: null } },
    select: { id: true, username: true, advertiserId: true }
  });

  let created = 0;
  let updated = 0;
  let skippedAlreadyPrimary = 0;

  for (const u of users) {
    if (!u.advertiserId) continue;
    const existing = await prisma.userAdvertiserBinding.findUnique({
      where: { userId_advertiserId: { userId: u.id, advertiserId: u.advertiserId } }
    });
    if (existing) {
      if (!existing.isPrimary) {
        await prisma.userAdvertiserBinding.update({
          where: { userId_advertiserId: { userId: u.id, advertiserId: u.advertiserId } },
          data: { isPrimary: true }
        });
        updated++;
        console.log(`[migrate] promote ${u.username} → ${u.advertiserId}`);
      } else {
        skippedAlreadyPrimary++;
      }
      continue;
    }
    await prisma.userAdvertiserBinding.create({
      data: {
        userId: u.id,
        advertiserId: u.advertiserId,
        isPrimary: true
      }
    });
    created++;
    console.log(`[migrate] create ${u.username} → ${u.advertiserId} (primary)`);
  }

  console.log(
    `[migrate] done: users=${users.length}, created=${created}, promoted=${updated}, skippedAlreadyPrimary=${skippedAlreadyPrimary}`
  );
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error("[migrate] failed", error);
    await prisma.$disconnect();
    process.exit(1);
  });