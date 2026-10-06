-- Facebook, Threads and YouTube accounts live next to Instagram ones.
ALTER TABLE "InstagramAccount" ADD COLUMN "platform" TEXT NOT NULL DEFAULT 'INSTAGRAM';

-- Campaigns created together across several networks share a group.
ALTER TABLE "Automation" ADD COLUMN "groupId" TEXT;
CREATE INDEX "Automation_groupId_idx" ON "Automation"("groupId");
