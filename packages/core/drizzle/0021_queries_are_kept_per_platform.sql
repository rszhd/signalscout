-- US-027. `generated_queries` held one list of queries for every platform a
-- monitor watches. It is now an object keyed by platform id, because a query
-- written for Reddit does not work on X: US-006 measured a six-word phrase
-- returning unrelated posts on X unquoted, and nothing at all quoted.
--
-- The column is already `jsonb`, so nothing about its type changes and the
-- Drizzle schema is unmoved. Only the value inside it moves, which is why this
-- migration is written by hand.
--
-- Every monitor keeps exactly the queries it had. Each platform it watches is
-- given the old list, so the next poll asks for what the last poll asked for.
-- Nothing is rewritten to fit the new rule here: a query a person wrote is
-- theirs, and shortening it silently would change what their monitor finds
-- without telling them.
UPDATE monitors
SET generated_queries = (
    SELECT jsonb_object_agg(source, monitors.generated_queries)
    FROM unnest(monitors.sources) AS source
  )
WHERE jsonb_typeof(generated_queries) = 'array'
  AND array_length(sources, 1) IS NOT NULL;

-- A monitor that names no platform keeps its array. It polls nothing, so there
-- is no platform to key the list by, and inventing one would put queries under
-- a platform the person never ticked. `monitorQueries` reads both shapes.
