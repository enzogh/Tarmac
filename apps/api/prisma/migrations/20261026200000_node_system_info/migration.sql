-- Hardware and OS reported by the agent with each heartbeat.
ALTER TABLE "Node" ADD COLUMN "systemInfo" JSONB;
