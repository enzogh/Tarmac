-- On-demand ping/traceroute results are no longer stored: they are shown to
-- whoever ran them and the link probes (VlanConnectionSample) keep the
-- history.
DROP TABLE IF EXISTS "VlanConnectionTest";
DROP TYPE IF EXISTS "VlanTestType";
