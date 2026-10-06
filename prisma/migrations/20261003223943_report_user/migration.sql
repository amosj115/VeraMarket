-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "conversationId" TEXT,
ADD COLUMN     "reportedUserId" TEXT;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reportedUserId_fkey" FOREIGN KEY ("reportedUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
