-- phpMyAdmin SQL Dump
-- version 5.2.2
-- https://www.phpmyadmin.net/
--
-- Host: localhost:3306
-- Generation Time: Jun 11, 2026 at 08:34 AM
-- Server version: 11.4.12-MariaDB
-- PHP Version: 8.4.21

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `alembicdigilabs_Digi_dmap_v2`
--

-- --------------------------------------------------------

--
-- Table structure for table `work_request_deferrals`
--

CREATE TABLE `work_request_deferrals` (
  `id` int(11) NOT NULL,
  `work_request_id` int(11) NOT NULL,
  `manager_id` int(11) NOT NULL,
  `reason` enum('insufficient_details','incorrect_request_type') NOT NULL,
  `message` text DEFAULT NULL,
  `old_request_type_id` int(11) DEFAULT NULL,
  `new_request_type_id` int(11) DEFAULT NULL,
  `old_project_type_id` int(11) DEFAULT NULL,
  `new_project_type_id` int(11) DEFAULT NULL,
  `deferred_at` datetime NOT NULL DEFAULT current_timestamp(),
  `client_resubmitted_at` datetime DEFAULT NULL,
  `resubmitted_by_user_id` int(11) DEFAULT NULL,
  `resubmission_count` int(11) NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Indexes for dumped tables
--

--
-- Indexes for table `work_request_deferrals`
--
ALTER TABLE `work_request_deferrals`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_work_request_deferrals_work_request_id` (`work_request_id`),
  ADD KEY `idx_work_request_deferrals_manager_id` (`manager_id`),
  ADD KEY `idx_work_request_deferrals_resubmitted_by_user_id` (`resubmitted_by_user_id`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `work_request_deferrals`
--
ALTER TABLE `work_request_deferrals`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `work_request_deferrals`
--
ALTER TABLE `work_request_deferrals`
  ADD CONSTRAINT `fk_work_request_deferrals_manager_id` FOREIGN KEY (`manager_id`) REFERENCES `users` (`id`) ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_work_request_deferrals_resubmitted_by_user_id` FOREIGN KEY (`resubmitted_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_work_request_deferrals_work_request_id` FOREIGN KEY (`work_request_id`) REFERENCES `work_requests` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
