-- Populate feedbacks.question based on task type (via task.task_type_id -> task_type.task_type)
-- Mapping provided
-- Requires `question` column present (alter_feedbacks_add_comments.sql)

-- PREVIEW
SELECT f.id,
       f.task_id,
       f.question AS existing_question,
       t.task_type_id,
       tt.task_type
FROM feedbacks f
JOIN tasks t ON t.id = f.task_id
LEFT JOIN task_type tt ON tt.id = t.task_type_id
WHERE f.is_deleted = 0;

-- APPLY (by task_type)
UPDATE feedbacks f
JOIN tasks t ON t.id = f.task_id
LEFT JOIN task_type tt ON tt.id = t.task_type_id
SET f.question = CASE
    WHEN tt.task_type = 'Graphic' THEN 'How well did the final design match your brand and what you asked for?'
    WHEN tt.task_type = 'Video' THEN 'How would you rate the final video overall?'
    WHEN tt.task_type = 'Shoot' THEN 'How satisfied are you with the shoot and the final output?'
    WHEN tt.task_type = 'Content' THEN 'How well did the copy sound like your brand and say what you needed?'
    WHEN tt.task_type = 'Web Application' THEN 'How easy and reliable was the application to use?'
    ELSE f.question
END
WHERE f.is_deleted = 0
  AND tt.task_type IN ('Graphic','Video','Shoot','Content','Web Application')
  AND (f.question IS NULL OR f.question = '');
