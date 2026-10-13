-- Feedback enhancements (per-rating comments, mandatory recommendation comment, question field)
-- `comments` is reused as the mandatory comment for recommendation_score.
ALTER TABLE `feedbacks`
    ADD COLUMN `question` TEXT NULL COMMENT 'Question or concern raised by the user regarding the task' AFTER `comments`,
    ADD COLUMN `rating_functionality_comment` TEXT NULL COMMENT 'Comment for functionality rating (required when rating < 4)' AFTER `question`,
    ADD COLUMN `rating_timeliness_comment` TEXT NULL COMMENT 'Comment for timeliness rating (required when rating < 4)' AFTER `rating_functionality_comment`,
    ADD COLUMN `rating_communication_comment` TEXT NULL COMMENT 'Comment for communication rating (required when rating < 4)' AFTER `rating_timeliness_comment`;
