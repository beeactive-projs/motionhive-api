-- 082: undo the Strength tags 081's backfill gave for weight loss.
--
-- 081 read "weight" and "greutate" on their own as strength, so a coach or
-- a group about weight loss ("Weight loss", "Pierdere în greutate") was
-- tagged Strength training. The list now keeps lifting ("weightlift",
-- "greutăți") and drops the bare words (fixed in 081 for new databases).
--
-- This removes the Strength rows that nothing else in the coach's
-- specializations, or the group's name and tags, still supports. A coach who
-- answered "What do you coach?" chose their categories themselves, so their
-- rows are left as they are. Nothing writes group categories yet, so every
-- group row came from the backfill.
--
-- Idempotent: a second run finds nothing to remove.

BEGIN;

DELETE FROM coach_category cc
 USING category c
 WHERE c.id = cc.category_id
   AND c.slug = 'strength'
   AND NOT EXISTS (
     SELECT 1 FROM user_onboarding_step s
      WHERE s.user_id = cc.user_id
        AND s.step = 'COACH_CATEGORIES'
        AND s.status = 'DONE'
   )
   AND NOT EXISTS (
     SELECT 1
       FROM instructor_profile ip
       CROSS JOIN LATERAL json_array_elements_text(
         CASE WHEN json_typeof(ip.specializations) = 'array'
           THEN ip.specializations ELSE '[]'::json END
       ) AS spec(value)
      WHERE ip.user_id = cc.user_id
        AND fold_for_search(spec.value)
          ~ '\m(strength|forta|power|lift|weightlift|haltere|putere|musculat|bodybuild|culturism|greutati)'
   );

DELETE FROM group_category gc
 USING category c, "group" g
 WHERE c.id = gc.category_id
   AND c.slug = 'strength'
   AND g.id = gc.group_id
   AND fold_for_search(
     concat_ws(' ', g.name, (
       SELECT string_agg(t.value, ' ')
         FROM json_array_elements_text(
           CASE WHEN json_typeof(g.tags::json) = 'array'
             THEN g.tags::json ELSE '[]'::json END
         ) AS t(value)
     ))
   ) !~ '\m(strength|forta|power|lift|weightlift|haltere|putere|musculat|bodybuild|culturism|greutati)';

COMMIT;
