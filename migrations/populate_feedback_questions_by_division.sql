-- Populate feedbacks.question based on the assigned user's division name.
-- Chain: feedbacks.task_id -> task_assignments -> user_divisions -> division (title)
-- Mapping
-- Requires question column (alter_feedbacks_add_comments.sql)

-- PREVIEW
SELECT f.id,
       f.task_id,
       f.question AS existing_question,
       d.title AS division
FROM feedbacks f
JOIN task_assignments ta ON ta.task_id = f.task_id
JOIN user_divisions ud ON ud.user_id = ta.user_id
JOIN division d ON d.id = ud.division_id
WHERE f.is_deleted = 0
  AND d.title IN ('Graphic','Video','Shoot','Content','Web Application');

-- APPLY
UPDATE feedbacks f
SET question = (
    SELECT CASE d.title
        WHEN 'Graphic' THEN 'How well did the final design match your brand and what you asked for?'
        WHEN 'Video' THEN 'How would you rate the final video overall?'
        WHEN 'Shoot' THEN 'How satisfied are you with the shoot and the final output?'
        WHEN 'Content' THEN 'How well did the copy sound like your brand and say what you needed?'
        WHEN 'Web Application' THEN 'How easy and reliable was the application to use?'
        ELSE NULL
    END
    FROM task_assignments ta
    JOIN user_divisions ud ON ud.user_id = ta.user_id
    JOIN division d ON d.id = ud.division_id
    WHERE ta.task_id = f.task_id
      AND d.title IN ('Graphic','Video','Shoot','Content','Web Application')
    ORDER BY ta.id DESC
    LIMIT 1
)
WHERE f.is_deleted = 0
  AND (f.question IS NULL OR f.question = '');
