-- phpMyAdmin SQL Dump
-- version 5.2.2
-- https://www.phpmyadmin.net/
--
-- Host: localhost:3306
-- Generation Time: Nov 12, 2025 at 06:40 AM
-- Server version: 11.4.9-MariaDB
-- PHP Version: 8.4.14

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `alembicdigilabs_Digi_dmap`
--

-- --------------------------------------------------------

--
-- Table structure for table `department`
--

CREATE TABLE `department` (
  `id` int(11) NOT NULL,
  `department_name` varchar(100) NOT NULL,
  `description` text DEFAULT NULL,
  `status` enum('Active','Inactive') DEFAULT 'Active',
  `state` enum('active','inactive') DEFAULT 'active',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

--
-- Dumping data for table `department`
--

INSERT INTO `department` (`id`, `department_name`, `description`, `status`, `created_at`, `updated_at`) VALUES
(1, 'Marketing', 'All marketing divisions of the company', 'Active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(2, 'Medical', 'All medical division employees of the company', 'Active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(3, 'Legal', 'All legal division employees of the company', 'Active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(4, 'CQA', 'All CQA division employees of the company', 'Active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(5, 'Business Enablers', 'All the other divisions of the company', 'Active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(6, 'IBU', 'Any divisions from company''s Vadodara HQ', 'Active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(7, 'Leadership', 'All employees with AGM & above designation', 'Active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(8, 'Corporate Communication', 'All verticals within Corp Comm', 'Active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(9, 'Digilabs', 'All verticals within Digilabs', 'Active', '2025-11-12 06:04:52', '2025-11-12 06:04:52');

-- --------------------------------------------------------

--
-- Table structure for table `division`
--

CREATE TABLE `division` (
  `id` int(11) NOT NULL,
  `title` varchar(100) NOT NULL,
  `department_id` int(11) NOT NULL,
  `description` text DEFAULT NULL,
  `state` enum('active','inactive') DEFAULT 'active',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

--
-- Dumping data for table `division`
--

INSERT INTO `division` (`id`, `title`, `department_id`, `description`, `created_at`, `updated_at`) VALUES
(1, 'Graphic', 9, 'Graphic design and visual creation', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(2, 'Video', 9, 'Video production and editing', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(3, 'Shoot', 9, 'Photography and shooting services', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(4, 'Content', 9, 'Content writing and creation', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(5, 'Web Application', 9, 'Web application development', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(6, 'Corporate Communication', 8, 'Corporate Communication Division', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(7, 'Legal & Compliance', 3, 'Legal & Compliance Division', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(8, 'Coporate Quality Assurance', 4, 'Coporate Quality Assurance Division', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(9, 'HR', 5, 'HR Division', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(10, 'Business Excellence', 5, 'Business Excellence Division', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(11, 'IT', 5, 'IT Division', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(12, 'SEAT', 5, 'SEAT Division', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(13, 'IBU', 4, 'IBU Division', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(14, 'Alcare', 1, 'Alcare Division', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(15, 'Algrow', 1, 'Algrow Division', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(16, 'Aqua', 1, 'Aqua Division', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(17, 'Cardigem', 1, 'Cardigem Division', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(18, 'Corazon', 1, 'Corazon Division', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(19, 'Corium', 1, 'Corium Division', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(20, 'Elena', 1, 'Elena Division', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(21, 'Enteron', 1, 'Enteron Division', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(22, 'Eyecare', 1, 'Eyecare Division', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(23, 'Farmcure', 1, 'Farmcure Division', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(24, 'Gastron', 1, 'Gastron Division', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(25, 'Generic', 1, 'Generic Division', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(26, 'Hospital Care', 1, 'Hospital Care Division', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(27, 'Maxis', 1, 'Maxis Division', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(28, 'Megacare', 1, 'Megacare Division', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(29, 'Nepal Business', 1, 'Nepal Business Division', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(30, 'Osteofit', 1, 'Osteofit Division', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(31, 'Ouron', 1, 'Ouron Division', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(32, 'Petal', 1, 'Petal Division', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(33, 'Pharma', 1, 'Pharma Division', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(34, 'Poultry', 1, 'Poultry Division', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(35, 'Specia', 1, 'Specia Division', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(36, 'Summit', 1, 'Summit Division', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(37, 'Veterinary', 1, 'Veterinary Division', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(38, 'Vetmax', 1, 'Vetmax Division', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(39, 'Zenovi', 1, 'Zenovi Division', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(40, 'Medical Services', 2, 'Medical Services Division', '2025-11-12 06:04:52', '2025-11-12 06:04:52');

-- --------------------------------------------------------

--
-- Table structure for table `job_role`
--

CREATE TABLE `job_role` (
  `id` int(11) NOT NULL,
  `role_title` varchar(100) NOT NULL,
  `level` varchar(50) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `department_id` int(11) DEFAULT NULL,
  `state` enum('active','inactive') DEFAULT 'active',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

--
-- Dumping data for table `job_role`
--

INSERT INTO `job_role` (`id`, `role_title`, `level`, `description`, `department_id`, `created_at`, `updated_at`) VALUES
(1, 'Super Admin', 'Senior', 'System administrators', 9, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(2, 'Creative Manager', 'Mid', 'Creative media managers ( for Graphic, Video, Content, Web App divisions)', 9, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(3, 'Creative User', 'Low', 'All subject matter experts such as designers, video editors, copywriters, developers, etc', 9, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(4, 'Marketing Manager', 'Mid', 'Marketing manager', 1, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(5, 'Marketing User', 'Low', 'All product manager levels', 1, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(6, 'Senior Leadership', 'Mid', 'Any user under Leadership department', 7, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(7, 'Other User', 'Low', 'Any user under Business Enabler department', 5, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(8, 'Medical Manager', 'Mid', 'Level 3 user of medical team', 2, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(9, 'Medical Senior', 'Low', 'Level 2 user of medical team', 2, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(10, 'Medical User', 'Low', 'Level 1 user of medical team', 2, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(11, 'Legal Manager', 'Mid', 'Level 3 user of legal team', 3, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(12, 'Legal Senior', 'Low', 'Level 2 user of legal team', 3, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(13, 'Lega User', 'Low', 'Level 1 user of legal team', 3, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(14, 'CQA Manager', 'Mid', 'Level 3 user of CQA team', 4, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(15, 'CQA Senior', 'Low', 'Level 2 user of CQA team', 4, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(16, 'CQA User', 'Low', 'Level 1 user of CQA team', 4, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(17, 'CComm Manager', 'Mid', 'Managers and up of corp comm division', 8, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(18, 'CComm User', 'Low', 'All users of corporate communication division', 8, '2025-11-12 06:04:52', '2025-11-12 06:04:52');

--
-- Table structure for table `designation`
--

CREATE TABLE `designation` (
  `id` int(11) NOT NULL,
  `designation_name` varchar(100) NOT NULL,
  `designation_category` varchar(50) NOT NULL,
  `state` enum('active','inactive') DEFAULT 'active',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

--
-- Dumping data for table `designation`
--

INSERT INTO `designation` (`id`, `designation_name`, `designation_category`, `created_at`, `updated_at`) VALUES
(1, 'CHRO & Chief Customer Experience Officer', 'Senior Leadership', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(2, 'Senior Vice President', 'Senior Leadership', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(3, 'Vice President', 'Senior Leadership', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(4, 'Executive Vice President', 'Senior Leadership', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(5, 'Associate Vice President', 'Senior Leadership', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(6, 'General Manager', 'Senior Leadership', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(7, 'Deputy General Manager', 'Senior Leadership', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(8, 'Marketing Manager', 'Marketing', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(9, 'Group Product Manager', 'Marketing', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(10, 'Senior Product Manager', 'Marketing', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(11, 'Product Manager', 'Marketing', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(12, 'Assistant Product Manager', 'Marketing', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(13, 'Product Executive', 'Marketing', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(14, 'Management Trainee', 'Marketing', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(15, 'Senior Manager', 'Others', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(16, 'Manager', 'Others', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(17, 'Deputy Manager', 'Others', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(18, 'Assistant Manager', 'Others', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(19, 'Senior Executive', 'Others', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(20, 'Executive', 'Others', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(21, 'Junior Executive', 'Others', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(22, 'Trainee', 'Others', '2025-11-12 06:04:52', '2025-11-12 06:04:52');

-- --------------------------------------------------------


-- Table structure for table `designation_departments`
--

CREATE TABLE `designation_departments` (
  `id` int(11) NOT NULL,
  `designation_id` int(11) NOT NULL,
  `department_id` int(11) NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

--
-- Dumping data for table `designation_departments`
--

INSERT INTO `designation_departments` (`id`, `designation_id`, `department_id`, `created_at`, `updated_at`) VALUES
(1, 1, 7, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(2, 2, 7, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(3, 3, 7, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(4, 4, 7, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(5, 5, 7, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(6, 6, 7, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(7, 7, 7, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(8, 8, 1, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(9, 9, 1, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(10, 10, 1, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(11, 11, 1, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(12, 12, 1, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(13, 13, 1, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(14, 14, 1, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(15, 15, 2, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(16, 15, 3, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(17, 15, 4, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(18, 15, 5, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(19, 15, 6, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(20, 15, 8, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(21, 15, 9, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(22, 16, 2, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(23, 16, 3, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(24, 16, 4, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(25, 16, 5, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(26, 16, 6, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(27, 16, 8, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(28, 16, 9, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(29, 17, 2, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(30, 17, 3, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(31, 17, 4, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(32, 17, 5, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(33, 17, 6, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(34, 17, 8, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(35, 17, 9, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(36, 18, 2, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(37, 18, 3, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(38, 18, 4, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(39, 18, 5, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(40, 18, 6, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(41, 18, 8, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(42, 18, 9, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(43, 19, 2, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(44, 19, 3, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(45, 19, 4, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(46, 19, 5, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(47, 19, 6, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(48, 19, 8, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(49, 19, 9, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(50, 20, 2, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(51, 20, 3, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(52, 20, 4, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(53, 20, 5, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(54, 20, 6, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(55, 20, 8, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(56, 20, 9, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(57, 21, 2, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(58, 21, 3, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(59, 21, 4, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(60, 21, 5, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(61, 21, 6, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(62, 21, 8, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(63, 21, 9, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(64, 22, 2, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(65, 22, 3, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(66, 22, 4, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(67, 22, 5, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(68, 22, 6, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(69, 22, 8, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(70, 22, 9, '2025-11-12 06:04:52', '2025-11-12 06:04:52');

-- --------------------------------------------------------
-- --------------------------------------------------------
-- --------------------------------------------------------

-- --------------------------------------------------------


-- Table structure for table `designation_jobroles`
--

CREATE TABLE `designation_jobroles` (
  `id` int(11) NOT NULL,
  `designation_id` int(11) NOT NULL,
  `jobrole_id` int(11) NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

--
-- Dumping data for table `designation_jobroles`
--

INSERT INTO `designation_jobroles` (`id`, `designation_id`, `jobrole_id`, `created_at`, `updated_at`) VALUES
(1, 1, 7, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(2, 2, 7, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(3, 3, 7, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(4, 4, 7, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(5, 5, 7, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(6, 6, 7, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(7, 7, 7, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(8, 8, 5, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(9, 9, 6, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(10, 10, 6, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(11, 11, 6, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(12, 12, 6, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(13, 13, 6, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(14, 14, 6, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(15, 15, 2, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(16, 16, 2, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(17, 17, 4, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(18, 18, 4, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(19, 19, 4, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(20, 20, 4, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(21, 21, 4, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(22, 22, 4, '2025-11-12 06:04:52', '2025-11-12 06:04:52');

-- --------------------------------------------------------
--
-- Table structure for table `location`
--

CREATE TABLE `location` (
  `id` int(11) NOT NULL,
  `location_name` varchar(100) NOT NULL,
  `type` enum('HO','HQ','Field','Other') NOT NULL,
  `description` text DEFAULT NULL,
  `state` enum('active','inactive') DEFAULT 'active',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

--
-- Dumping data for table `location`
--

INSERT INTO `location` (`id`, `location_name`, `type`, `description`, `created_at`, `updated_at`) VALUES
(1, 'Mumbai HO', 'HO', 'Head Office Mumbai', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(2, 'Field', 'Field', 'Field Office', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(3, 'Vadodara HQ', 'HQ', 'Headquarters Vadodara', '2025-11-12 06:04:52', '2025-11-12 06:04:52');

-- --------------------------------------------------------

--
-- Table structure for table `sales`
--

CREATE TABLE `sales` (
  `id` int(11) NOT NULL,
  `emp_code` int(11) NOT NULL,
  `emp_name` varchar(100) NOT NULL,
  `level` varchar(50) DEFAULT NULL,
  `hq` varchar(100) DEFAULT NULL,
  `region` varchar(100) DEFAULT NULL,
  `zone` varchar(100) DEFAULT NULL,
  `division_id` int(11) DEFAULT NULL,
  `sap_code` int(11) NOT NULL,
  `mobile_number` varchar(15) DEFAULT NULL,
  `email_id` varchar(100) NOT NULL,
  `user_type` enum('sales') DEFAULT 'sales',
  `email_verified_status` tinyint(1) DEFAULT 0,
  `password` varchar(255) DEFAULT NULL,
  `account_status` enum('pending','active','inactive','locked','rejected','vacant') DEFAULT 'pending',
  `last_login` datetime DEFAULT NULL,
  `login_attempts` int(11) DEFAULT 0,
  `lock_until` datetime DEFAULT NULL,
  `password_changed_at` datetime DEFAULT NULL,
  `password_expires_at` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

--
-- Dumping data for table `sales`
--

INSERT INTO `sales` (`id`, `emp_code`, `emp_name`, `level`, `hq`, `region`, `zone`, `division_id`, `sap_code`, `mobile_number`, `email_id`, `user_type`, `email_verified_status`, `password`, `account_status`, `last_login`, `login_attempts`, `lock_until`, `password_changed_at`, `password_expires_at`, `created_at`, `updated_at`) VALUES
(1, 12345, 'Demo Sales User', 'Junior', 'Mumbai', 'West', 'Zone A', 14, 67890, '9876543210', 'demo.sales@alembic.co.in', 'sales', 1, '$2b$10$demo.hash.for.sales.user.password123', 'active', NULL, 0, NULL, '2025-11-21 07:24:00', '2026-02-19 07:24:00', '2025-11-21 07:24:00', '2025-11-21 07:24:00');

-- --------------------------------------------------------

--
-- Table structure for table `tasks`
--

CREATE TABLE `tasks` (
  `id` int(11) NOT NULL,
  `quarter` varchar(20) DEFAULT NULL,
  `project_name` varchar(255) NOT NULL,
  `assigned_by_id` int(11) DEFAULT NULL,
  `division_id` int(11) DEFAULT NULL,
  `work_type` enum('Design','Video','Development','Marketing','Content','Photography','Branding','UI/UX','Backend','New Mod') DEFAULT 'Design',
  `work_medium_id` int(11) DEFAULT NULL,
  `task_type` varchar(100) DEFAULT NULL,
  `artist_id` int(11) DEFAULT NULL,
  `manager_id` int(11) DEFAULT NULL,
  `no_of_work_pages` int(11) DEFAULT 0,
  `no_of_project` int(11) DEFAULT 0,
  `no_of_options` int(11) DEFAULT 0,
  `no_of_takes_photos` int(11) DEFAULT 0,
  `no_of_words` int(11) DEFAULT 0,
  `no_of_overdue` int(11) DEFAULT 0,
  `month` varchar(20) DEFAULT NULL,
  `request_date` date DEFAULT NULL,
  `initiation_date` date DEFAULT NULL,
  `completion_date` date DEFAULT NULL,
  `project_status` enum('upcoming','ongoing','completed') DEFAULT 'upcoming',
  `leadership` varchar(100) DEFAULT NULL,
  `concept` text DEFAULT NULL,
  `shoot_set_up` text DEFAULT NULL,
  `shoot_hours` decimal(5,2) DEFAULT NULL,
  `resize` tinyint(1) DEFAULT 0,
  `last_moment_work` tinyint(1) DEFAULT 0,
  `project_scale` enum('small','medium','high') DEFAULT NULL,
  `project_priority` enum('critical','high','publish date') DEFAULT NULL,
  `highlighted` tinyint(1) DEFAULT 0,
  `appreciation` varchar(255) DEFAULT NULL,
  `appreciated_by` varchar(100) DEFAULT NULL,
  `appreciated_at` datetime DEFAULT NULL,
  `remark` text DEFAULT NULL,
  `brief_comments` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

-- --------------------------------------------------------

--
-- Table structure for table `users`
--

CREATE TABLE `users` (
  `id` int(11) NOT NULL,
  `name` varchar(100) DEFAULT NULL,
  `email` varchar(100) NOT NULL,
  `phone` varchar(15) DEFAULT NULL,
  `password` varchar(255) DEFAULT NULL,
  `department_id` int(11) DEFAULT NULL,
  `job_role_id` int(11) DEFAULT NULL,
  `location_id` int(11) DEFAULT NULL,
  `designation_id` int(11) DEFAULT NULL,
  `email_verified_status` tinyint(1) DEFAULT 0,
  `account_status` enum('pending','active','inactive','locked','rejected','vacant') DEFAULT 'pending',
  `last_login` datetime DEFAULT NULL,
  `login_attempts` int(11) DEFAULT 0,
  `lock_until` datetime DEFAULT NULL,
  `password_changed_at` datetime DEFAULT NULL,
  `password_expires_at` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

--
-- Dumping data for table `users`
--

INSERT INTO `users` (`id`, `name`, `email`, `phone`, `password`, `department_id`, `job_role_id`, `location_id`, `designation_id`, `email_verified_status`, `account_status`, `last_login`, `login_attempts`, `lock_until`, `password_changed_at`, `password_expires_at`, `created_at`, `updated_at`) VALUES
(1, 'System Admin', 'admin@alembic.co.in', '8080302041', '$2a$12$/.rT3avNPO1l0ZjqSRS/Ru09mKVNuIRSLaHjBDeMwLHscVLq1ETY6', 2, 1, 1, NULL, 1, 'active', '2025-11-12 06:04:52', 0, NULL, '2025-11-12 06:04:52', '2026-02-10 06:04:52', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(2, 'Harsh Gohil', 'harsh.gohil@alembic.co.in', '8080302042', '$2b$10$GJmBy5B8VE9lQH5hOgzMb.xP6VEP10IwtD80di3Uniu3aaazcU8yy', 2, 3, 1, NULL, 1, 'active', NULL, 0, NULL, '2025-11-12 06:06:13', '2026-02-10 06:06:13', '2025-11-12 06:04:58', '2025-11-12 06:06:13'),
(3, 'Nikhil Nadkar', 'nikhil.nadkar@alembic.co.in', '8080302042', '$2b$10$i7Z7bTmqBpmyPRcxrqoX1OE7upFSVXqFXiYzQqoIW7pt8M2FD6.Uq', 1, 4, 1, NULL, 1, 'active', '2025-11-12 06:35:08', 0, NULL, '2025-11-12 06:11:11', '2026-02-10 06:11:11', '2025-11-12 06:10:01', '2025-11-12 06:35:08'),
(4, 'Mohanish Padwal', 'mohanish.padwal@alembic.co.in', NULL, '$2b$10$Ji2xiG/5vdtbeUc3.FdcIOAymaHhMB1hBrOwoFawALpGc7VX10fD.', 2, 2, 1, NULL, 1, 'active', NULL, 0, NULL, '2025-11-19 08:12:00', '2026-02-17 08:12:00', '2025-11-19 08:12:00', '2025-11-19 08:12:00'),
(5, 'Bhagwan Parab', 'bhagwan.parab@alembic.co.in', NULL, '$2b$10$mSvKWrDwZCZyM5LR7zLWgOkqRUebR76dmXyiCnSUr.Y6Ft1njZKum', 2, 2, 1, NULL, 1, 'active', NULL, 0, NULL, '2025-11-19 08:12:00', '2026-02-17 08:12:00', '2025-11-19 08:12:00', '2025-11-19 08:12:00');

-- --------------------------------------------------------

--
-- Table structure for table `user_divisions`
--

CREATE TABLE `user_divisions` (
  `id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `division_id` int(11) NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

--
-- Dumping data for table `user_divisions`
--

INSERT INTO `user_divisions` (`id`, `user_id`, `division_id`, `created_at`, `updated_at`) VALUES
(1, 2, 5, '2025-11-12 06:06:13', '2025-11-12 06:06:13'),
(2, 2, 4, '2025-11-12 06:06:13', '2025-11-12 06:06:13'),
(3, 1, 1, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(4, 3, 20, '2025-11-12 06:10:01', '2025-11-12 06:10:01'),
(5, 4, 5, '2025-11-19 08:12:00', '2025-11-19 08:12:00'),
(6, 5, 5, '2025-11-19 08:12:00', '2025-11-19 08:12:00');

-- --------------------------------------------------------


--
-- Table structure for table `work_medium`
--

CREATE TABLE `work_medium` (
  `id` int(11) NOT NULL,
  `type` varchar(100) NOT NULL,
  `category` varchar(100) NOT NULL,
  `description` text DEFAULT NULL,
  `division_id` int(11) NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

--
-- Dumping data for table `work_medium`
--

INSERT INTO `work_medium` (`id`, `type`, `category`, `description`, `division_id`, `created_at`, `updated_at`) VALUES
(1, 'DIGITAL', 'Digital Artworks', 'Infographics, Social Media, Magazine, etc.', 1, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(2, 'DIGITAL', 'Web Application', 'VA HTMLization, Websites, Brand Gamifications, etc...', 5, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(3, 'PRINT', 'Print Artwork', 'Posters, Banners, LBL, Standees, etc.', 1, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(4, 'VIDEO & AUDIO', 'Video Shoot', 'Video shooting services', 2, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(5, 'VIDEO & AUDIO', 'Product/Pack-shot Shoot', 'Product and packaging photography', 2, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(6, 'VIDEO & AUDIO', 'Motion Graphics', 'Motion graphics and animation', 2, '2025-11-11 06:52:31', '2025-11-11 06:52:31');

-- --------------------------------------------------------

--
-- Table structure for table `work_requests`
--

CREATE TABLE `work_requests` (
  `id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `project_name` varchar(255) NOT NULL,
  `brand` varchar(100) DEFAULT NULL,
  `work_medium_id` int(11) NOT NULL,
  `project_details` text DEFAULT NULL,
  `priority` enum('low','medium','high','critical') DEFAULT 'medium',
  `status` enum('draft','pending','accepted','assigned','in_progress','completed','rejected') DEFAULT 'pending',
  `requested_manager_id` int(11) DEFAULT NULL,
  `requested_at` datetime DEFAULT NULL,
  `remarks` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

--
-- Dumping data for table `work_requests`
--

INSERT INTO `work_requests` (`id`, `user_id`, `project_name`, `brand`, `work_medium_id`, `project_details`, `priority`, `status`, `requested_manager_id`, `requested_at`, `remarks`, `created_at`, `updated_at`) VALUES
(4, 3, 'New Product Launch Campaign', 'Alembic Pharma', 2, 'Detailed description of the project requirements, objectives, and deliverables', 'high', 'pending', 2, '2025-11-12 06:35:19', NULL, '2025-11-12 06:35:19', '2025-11-12 06:35:19');

-- --------------------------------------------------------

--
-- Table structure for table `work_request_documents`
--

CREATE TABLE `work_request_documents` (
  `id` int(11) NOT NULL,
  `work_request_id` int(11) NOT NULL,
  `document_name` varchar(255) NOT NULL,
  `document_path` varchar(500) NOT NULL,
  `document_type` varchar(50) DEFAULT NULL,
  `document_size` int(11) DEFAULT NULL,
  `uploaded_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

--
-- Dumping data for table `work_request_documents`
--

INSERT INTO `work_request_documents` (`id`, `work_request_id`, `document_name`, `document_path`, `document_type`, `document_size`, `uploaded_at`) VALUES
(1, 4, 'claimRepudationLetter.pdf', '/Users/harsh.gohil/Documents/Harsh Gohil/Projects/Divisions/Digilabs/D Map Upgraded/uploads/work-request/New Product Launch Campaign/claimRepudationLetter_1762929319626.pdf', 'application/pdf', 680283, '2025-11-12 06:35:19'),
(2, 4, 'GMC-26220130003-26278.pdf', '/Users/harsh.gohil/Documents/Harsh Gohil/Projects/Divisions/Digilabs/D Map Upgraded/uploads/work-request/New Product Launch Campaign/GMC-26220130003-26278_1762929319701.pdf', 'application/pdf', 152774, '2025-11-12 06:35:19');

--
-- Indexes for dumped tables
--

--
-- Indexes for table `department`
--
ALTER TABLE `department`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `division`
--
ALTER TABLE `division`
  ADD PRIMARY KEY (`id`),
  ADD KEY `department_id` (`department_id`);

--
-- Indexes for table `designation`
--
ALTER TABLE `designation`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `designation_departments`
--
ALTER TABLE `designation_departments`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_designation_department` (`designation_id`,`department_id`),
  ADD KEY `designation_id` (`designation_id`),
  ADD KEY `department_id` (`department_id`);

--
-- Indexes for table `designation_jobroles`
--
ALTER TABLE `designation_jobroles`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_designation_jobrole` (`designation_id`,`jobrole_id`),
  ADD KEY `designation_id` (`designation_id`),
  ADD KEY `jobrole_id` (`jobrole_id`);

--
-- Indexes for table `job_role`
--
ALTER TABLE `job_role`
  ADD PRIMARY KEY (`id`),
  ADD KEY `department_id` (`department_id`);

--
-- Indexes for table `location`
--
ALTER TABLE `location`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `sales`
--
ALTER TABLE `sales`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_emp_code` (`emp_code`),
  ADD UNIQUE KEY `unique_sap_code` (`sap_code`),
  ADD UNIQUE KEY `unique_email_id` (`email_id`),
  ADD KEY `division_id` (`division_id`);

--
-- Indexes for table `tasks`
--
ALTER TABLE `tasks`
  ADD PRIMARY KEY (`id`),
  ADD KEY `division_id` (`division_id`),
  ADD KEY `work_medium_id` (`work_medium_id`),
  ADD KEY `manager_id` (`manager_id`),
  ADD KEY `assigned_by_id` (`assigned_by_id`),
  ADD KEY `artist_id` (`artist_id`);

--
-- Indexes for table `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_email` (`email`),
  ADD KEY `department_id` (`department_id`),
  ADD KEY `job_role_id` (`job_role_id`),
  ADD KEY `location_id` (`location_id`),
  ADD KEY `designation_id` (`designation_id`);

--
-- Indexes for table `user_divisions`
--
ALTER TABLE `user_divisions`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_user_division` (`user_id`,`division_id`),
  ADD KEY `division_id` (`division_id`);


--
-- Indexes for table `work_medium`
--
ALTER TABLE `work_medium`
  ADD PRIMARY KEY (`id`),
  ADD KEY `division_id` (`division_id`);

--
-- Indexes for table `work_requests`
--
ALTER TABLE `work_requests`
  ADD PRIMARY KEY (`id`),
  ADD KEY `user_id` (`user_id`),
  ADD KEY `work_medium_id` (`work_medium_id`),
  ADD KEY `requested_manager_id` (`requested_manager_id`),
  ADD KEY `idx_work_requests_status` (`status`),
  ADD KEY `idx_work_requests_priority` (`priority`),
  ADD KEY `idx_work_requests_created_at` (`created_at`),
  ADD KEY `idx_work_requests_updated_at` (`updated_at`),
  ADD KEY `idx_work_requests_project_name` (`project_name`),
  ADD KEY `idx_work_requests_brand` (`brand`),
  ADD KEY `idx_work_requests_search` (`status`, `priority`, `created_at`),
  ADD KEY `idx_work_requests_user_search` (`user_id`, `status`, `created_at`),
  ADD KEY `idx_work_requests_manager_search` (`requested_manager_id`, `status`, `created_at`),
  ADD FULLTEXT KEY `ft_work_requests_content` (`project_name`, `brand`, `project_details`);

--
-- Indexes for table `work_request_documents`
--
ALTER TABLE `work_request_documents`
  ADD PRIMARY KEY (`id`),
  ADD KEY `work_request_id` (`work_request_id`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `department`
--
ALTER TABLE `department`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=7;

--
-- AUTO_INCREMENT for table `division`
--
ALTER TABLE `division`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=41;

--
-- AUTO_INCREMENT for table `designation`
--
ALTER TABLE `designation`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=23;

--
-- AUTO_INCREMENT for table `designation_departments`
--
ALTER TABLE `designation_departments`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=71;

--
-- AUTO_INCREMENT for table `designation_jobroles`
--
ALTER TABLE `designation_jobroles`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=23;

--
-- AUTO_INCREMENT for table `job_role`
--
ALTER TABLE `job_role`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=7;

--
-- AUTO_INCREMENT for table `location`
--
ALTER TABLE `location`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=4;

--
-- AUTO_INCREMENT for table `sales`
--
ALTER TABLE `sales`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT for table `tasks`
--
ALTER TABLE `tasks`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `users`
--
ALTER TABLE `users`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=6;

--
-- AUTO_INCREMENT for table `user_divisions`
--
ALTER TABLE `user_divisions`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=7;


--
-- AUTO_INCREMENT for table `work_medium`
--
ALTER TABLE `work_medium`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=7;

--
-- AUTO_INCREMENT for table `work_requests`
--
ALTER TABLE `work_requests`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=5;

--
-- AUTO_INCREMENT for table `work_request_documents`
--
ALTER TABLE `work_request_documents`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=3;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `division`
--
ALTER TABLE `division`
  ADD CONSTRAINT `division_ibfk_1` FOREIGN KEY (`department_id`) REFERENCES `department` (`id`);

--
-- Constraints for table `sales`
--
ALTER TABLE `sales`
  ADD CONSTRAINT `sales_ibfk_1` FOREIGN KEY (`division_id`) REFERENCES `division` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `tasks`
--
ALTER TABLE `tasks`
  ADD CONSTRAINT `tasks_ibfk_1` FOREIGN KEY (`division_id`) REFERENCES `division` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `tasks_ibfk_2` FOREIGN KEY (`work_medium_id`) REFERENCES `work_medium` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `tasks_ibfk_4` FOREIGN KEY (`manager_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `tasks_ibfk_5` FOREIGN KEY (`assigned_by_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `tasks_ibfk_6` FOREIGN KEY (`artist_id`) REFERENCES `users` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `designation_departments`
--
ALTER TABLE `designation_departments`
  ADD CONSTRAINT `designation_departments_ibfk_1` FOREIGN KEY (`designation_id`) REFERENCES `designation` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `designation_departments_ibfk_2` FOREIGN KEY (`department_id`) REFERENCES `department` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `designation_jobroles`
--
ALTER TABLE `designation_jobroles`
  ADD CONSTRAINT `designation_jobroles_ibfk_1` FOREIGN KEY (`designation_id`) REFERENCES `designation` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `designation_jobroles_ibfk_2` FOREIGN KEY (`jobrole_id`) REFERENCES `job_role` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `job_role`
--
ALTER TABLE `job_role`
  ADD CONSTRAINT `job_role_ibfk_1` FOREIGN KEY (`department_id`) REFERENCES `department` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `users`
--
ALTER TABLE `users`
  ADD CONSTRAINT `users_ibfk_1` FOREIGN KEY (`department_id`) REFERENCES `department` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `users_ibfk_2` FOREIGN KEY (`job_role_id`) REFERENCES `job_role` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `users_ibfk_4` FOREIGN KEY (`location_id`) REFERENCES `location` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `users_ibfk_5` FOREIGN KEY (`designation_id`) REFERENCES `designation` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `user_divisions`
--
ALTER TABLE `user_divisions`
  ADD CONSTRAINT `user_divisions_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `user_divisions_ibfk_2` FOREIGN KEY (`division_id`) REFERENCES `division` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `work_medium`
--
ALTER TABLE `work_medium`
  ADD CONSTRAINT `work_medium_ibfk_1` FOREIGN KEY (`division_id`) REFERENCES `division` (`id`);

--
-- Constraints for table `work_requests`
--
ALTER TABLE `work_requests`
  ADD CONSTRAINT `work_requests_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `work_requests_ibfk_2` FOREIGN KEY (`work_medium_id`) REFERENCES `work_medium` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `work_requests_ibfk_3` FOREIGN KEY (`requested_manager_id`) REFERENCES `users` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `work_request_documents`
--
ALTER TABLE `work_request_documents`
  ADD CONSTRAINT `work_request_documents_ibfk_1` FOREIGN KEY (`work_request_id`) REFERENCES `work_requests` (`id`) ON DELETE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
