-- phpMyAdmin SQL Dump
-- version 5.2.2
-- https://www.phpmyadmin.net/
--
-- Host: localhost:3306
-- Generation Time: Dec 02, 2025 at 08:44 AM
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
  `state` enum('active','inactive') DEFAULT 'active',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

--
-- Dumping data for table `department`
--

INSERT INTO `department` (`id`, `department_name`, `description`, `state`, `created_at`, `updated_at`) VALUES
(1, 'Marketing', 'All marketing divisions of the company', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(2, 'Medical', 'All medical division employees of the company', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(3, 'Legal', 'All legal division employees of the company', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(4, 'CQA', 'All CQA division employees of the company', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(5, 'Business Enablers', 'All the other divisions of the company', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(6, 'IBU', 'Any divisions from company\'s Vadodara HQ', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(7, 'Leadership', 'All employees with AGM & above designation', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(8, 'Corporate Communication', 'All verticals within Corp Comm', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(9, 'Digilabs', 'All verticals within Digilabs', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52');

-- --------------------------------------------------------

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

INSERT INTO `designation` (`id`, `designation_name`, `designation_category`, `state`, `created_at`, `updated_at`) VALUES
(1, 'CHRO & Chief Customer Experience Officer', 'Senior Leadership', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(2, 'Senior Vice President', 'Senior Leadership', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(3, 'Vice President', 'Senior Leadership', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(4, 'Executive Vice President', 'Senior Leadership', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(5, 'Associate Vice President', 'Senior Leadership', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(6, 'General Manager', 'Senior Leadership', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(7, 'Deputy General Manager', 'Senior Leadership', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(8, 'Marketing Manager', 'Marketing', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(9, 'Group Product Manager', 'Marketing', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(10, 'Senior Product Manager', 'Marketing', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(11, 'Product Manager', 'Marketing', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(12, 'Assistant Product Manager', 'Marketing', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(13, 'Product Executive', 'Marketing', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(14, 'Management Trainee', 'Marketing', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(15, 'Senior Manager', 'Others', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(16, 'Manager', 'Others', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(17, 'Deputy Manager', 'Others', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(18, 'Assistant Manager', 'Others', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(19, 'Senior Executive', 'Others', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(20, 'Executive', 'Others', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(21, 'Junior Executive', 'Others', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(22, 'Trainee', 'Others', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52');

-- --------------------------------------------------------

--
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

--
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
(17, 17, 3, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(18, 18, 4, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(19, 19, 4, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(20, 20, 4, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(21, 21, 4, '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(22, 22, 4, '2025-11-12 06:04:52', '2025-11-12 06:04:52');

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

INSERT INTO `division` (`id`, `title`, `department_id`, `description`, `state`, `created_at`, `updated_at`) VALUES
(1, 'Graphic', 9, 'Graphic design and visual creation', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(2, 'Video', 9, 'Video production and editing', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(3, 'Shoot', 9, 'Photography and shooting services', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(4, 'Content', 9, 'Content writing and creation', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(5, 'Web Application', 9, 'Web application development', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(6, 'Corporate Communication', 8, 'Corporate Communication Division', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(7, 'Legal & Compliance', 3, 'Legal & Compliance Division', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(8, 'Coporate Quality Assurance', 4, 'Coporate Quality Assurance Division', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(9, 'HR', 5, 'HR Division', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(10, 'Business Excellence', 5, 'Business Excellence Division', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(11, 'IT', 5, 'IT Division', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(12, 'SEAT', 5, 'SEAT Division', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(13, 'IBU', 4, 'IBU Division', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(14, 'Alcare', 1, 'Alcare Division', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(15, 'Algrow', 1, 'Algrow Division', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(16, 'Aqua', 1, 'Aqua Division', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(17, 'Cardigem', 1, 'Cardigem Division', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(18, 'Corazon', 1, 'Corazon Division', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(19, 'Corium', 1, 'Corium Division', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(20, 'Elena', 1, 'Elena Division', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(21, 'Enteron', 1, 'Enteron Division', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(22, 'Eyecare', 1, 'Eyecare Division', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(23, 'Farmcure', 1, 'Farmcure Division', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(24, 'Gastron', 1, 'Gastron Division', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(25, 'Generic', 1, 'Generic Division', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(26, 'Hospital Care', 1, 'Hospital Care Division', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(27, 'Maxis', 1, 'Maxis Division', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(28, 'Megacare', 1, 'Megacare Division', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(29, 'Nepal Business', 1, 'Nepal Business Division', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(30, 'Osteofit', 1, 'Osteofit Division', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(31, 'Ouron', 1, 'Ouron Division', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(32, 'Petal', 1, 'Petal Division', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(33, 'Pharma', 1, 'Pharma Division', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(34, 'Poultry', 1, 'Poultry Division', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(35, 'Specia', 1, 'Specia Division', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(36, 'Summit', 1, 'Summit Division', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(37, 'Veterinary', 1, 'Veterinary Division', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(38, 'Vetmax', 1, 'Vetmax Division', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(39, 'Zenovi', 1, 'Zenovi Division', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(40, 'Medical Services', 2, 'Medical Services Division', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52');

-- --------------------------------------------------------

--
-- Table structure for table `issue_register`
--

CREATE TABLE `issue_register` (
  `id` int(11) NOT NULL,
  `change_issue_type` varchar(100) NOT NULL,
  `description` text DEFAULT NULL,
  `quantification` varchar(100) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

--
-- Dumping data for table `issue_register`
--

INSERT INTO `issue_register` (`id`, `change_issue_type`, `description`, `quantification`, `created_at`, `updated_at`) VALUES
(1, 'Content Update', 'Web + Graphics + Videos', 'No. of issues reported/changes requested', '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(2, 'Button/Icon Replacement', 'Web', 'No. of issues reported', '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(3, 'Layout Restructure', 'Web', 'No. of issues reported', '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(4, 'Device Responsiveness Fix', 'Web', 'No. of issues reported', '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(5, 'Colour/Theme Update', 'Web', 'No. of issues reported', '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(6, 'Bug fixes', 'Web', 'No. of issues reported', '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(7, 'Form Field Update', 'Web', 'No. of issues reported', '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(8, 'API/Link Update', 'Web', 'No. of issues reported', '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(9, 'Grammar & Spell Check', 'Content Writing', 'No. of changes requested', '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(10, 'Copy/Fact Update', 'Content Writing', 'No. of changes requested', '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(11, 'Brand Tone/Language Alignment', 'Content Writing', 'No. of changes requested', '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(12, 'SEO Addition/Optimization', 'Content Writing', 'No. of changes requested', '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(13, 'Brand Terminology Consistency', 'Content Writing', 'No. of changes requested', '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(14, 'Regional Language Translation', 'Content Writing', 'No. of changes requested', '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(15, 'Add Compliance/Legal Points', 'Content Writing', 'No. of changes requested', '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(16, 'Shorten/Expand Content', 'Content Writing', 'No. of changes requested', '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(17, 'Resize Layout', 'Graphics + Videos', 'No. of changes requested', '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(18, 'Font Change/Alignment', 'Graphics', 'No. of changes requested', '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(19, 'Colour Change', 'Graphics', 'No. of changes requested', '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(20, 'Image Replacement', 'Graphics', 'No. of changes requested', '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(21, 'Brand Identity Update', 'Graphics', 'No. of changes requested', '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(22, 'Language Adaptation', 'Graphics', 'No. of changes requested', '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(23, 'Print Margin Update', 'Graphics', 'No. of changes requested', '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(24, 'Print Format Compatibility', 'Graphics', 'No. of changes requested', '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(25, 'Theme Change', 'Graphics', 'No. of changes requested', '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(26, 'Voice-Over Replacement', 'Videos', 'No. of changes requested', '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(27, 'Music Track Update', 'Videos', 'No. of changes requested', '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(28, 'Trimming/Sequencing', 'Videos', 'No. of changes requested', '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(29, 'Logo Update', 'Videos', 'No. of changes requested', '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(30, 'Add Animation/Transitions', 'Videos', 'No. of changes requested', '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(31, 'Replace Product Shots/Visuals', 'Videos', 'No. of changes requested', '2025-11-25 06:35:16', '2025-11-25 06:35:16');

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

INSERT INTO `job_role` (`id`, `role_title`, `level`, `description`, `department_id`, `state`, `created_at`, `updated_at`) VALUES
(1, 'Super Admin', 'Senior', 'System administrators', 9, 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(2, 'Creative Manager', 'Mid', 'Creative media managers ( for Graphic, Video, Content, Web App divisions)', 9, 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(3, 'Creative Lead', 'Mid', 'All leads who can be backup for Creative Managers', 9, 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(4, 'Creative User', 'Low', 'All subject matter experts such as designers, video editors, copywriters, developers, etc', 9, 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(5, 'Marketing Manager', 'Mid', 'Marketing manager', 1, 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(6, 'Marketing User', 'Low', 'All product manager levels', 1, 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(7, 'Senior Leadership', 'Mid', 'Any user under Leadership department', 7, 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(8, 'Other User', 'Low', 'Any user under Business Enabler department', 5, 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(9, 'Medical Manager', 'Mid', 'Level 3 user of medical team', 2, 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(10, 'Medical Senior', 'Low', 'Level 2 user of medical team', 2, 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(11, 'Medical User', 'Low', 'Level 1 user of medical team', 2, 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(12, 'Legal Manager', 'Mid', 'Level 3 user of legal team', 3, 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(13, 'Legal Senior', 'Low', 'Level 2 user of legal team', 3, 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(14, 'Legal User', 'Low', 'Level 1 user of legal team', 3, 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(15, 'CQA Manager', 'Mid', 'Level 3 user of CQA team', 4, 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(16, 'CQA Senior', 'Low', 'Level 2 user of CQA team', 4, 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(17, 'CQA User', 'Low', 'Level 1 user of CQA team', 4, 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(18, 'CComm Manager', 'Mid', 'Managers and up of corp comm division', 8, 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(19, 'CComm User', 'Low', 'All users of corporate communication division', 8, 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52');

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

INSERT INTO `location` (`id`, `location_name`, `type`, `description`, `state`, `created_at`, `updated_at`) VALUES
(1, 'Mumbai HO', 'HO', 'Head Office Mumbai', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(2, 'Field', 'Field', 'Field Office', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52'),
(3, 'Vadodara HQ', 'HQ', 'Headquarters Vadodara', 'active', '2025-11-12 06:04:52', '2025-11-12 06:04:52');

-- --------------------------------------------------------

--
-- Table structure for table `project_request_reference`
--

CREATE TABLE `project_request_reference` (
  `id` int(11) NOT NULL,
  `project_id` int(11) NOT NULL,
  `request_id` int(11) NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

--
-- Dumping data for table `project_request_reference`
--

INSERT INTO `project_request_reference` (`id`, `project_id`, `request_id`, `created_at`, `updated_at`) VALUES
(1, 1, 5, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(2, 2, 5, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(3, 3, 5, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(4, 4, 5, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(5, 5, 5, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(6, 6, 5, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(7, 7, 5, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(8, 8, 5, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(9, 9, 5, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(10, 10, 5, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(11, 11, 5, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(12, 12, 5, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(13, 13, 5, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(14, 14, 1, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(15, 15, 1, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(16, 16, 2, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(17, 17, 2, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(18, 18, 2, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(19, 19, 2, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(20, 20, 2, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(21, 21, 2, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(22, 22, 2, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(23, 23, 2, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(24, 24, 2, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(25, 25, 3, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(26, 26, 3, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(27, 27, 3, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(28, 28, 3, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(29, 29, 3, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(30, 30, 4, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(31, 31, 4, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(32, 32, 4, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(33, 1, 6, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(34, 2, 6, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(35, 3, 6, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(36, 4, 6, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(37, 5, 6, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(38, 6, 6, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(39, 7, 6, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(40, 8, 6, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(41, 9, 6, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(42, 10, 6, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(43, 11, 6, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(44, 12, 6, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(45, 13, 6, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(46, 14, 6, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(47, 15, 6, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(48, 16, 6, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(49, 17, 6, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(50, 18, 6, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(51, 19, 6, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(52, 20, 6, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(53, 21, 6, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(54, 22, 6, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(55, 23, 6, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(56, 24, 6, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(57, 25, 6, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(58, 26, 6, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(59, 27, 6, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(60, 28, 6, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(61, 29, 6, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(62, 30, 6, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(63, 31, 6, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(64, 32, 6, '2025-11-11 06:52:31', '2025-11-11 06:52:31');

-- --------------------------------------------------------

--
-- Table structure for table `project_type`
--

CREATE TABLE `project_type` (
  `id` int(11) NOT NULL,
  `project_type` varchar(100) NOT NULL,
  `description` text DEFAULT NULL,
  `quantification` varchar(100) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

--
-- Dumping data for table `project_type`
--

INSERT INTO `project_type` (`id`, `project_type`, `description`, `quantification`, `created_at`, `updated_at`) VALUES
(1, 'VA HTMLization', 'Converting Visual Aids into interactive HTML format', 'No. of vas htmlised', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(2, 'Photo Framer', 'Framing photos digitally', 'No. of photo framers made', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(3, 'Poster Maker', 'Online tool to create posters', 'No. of poster makers made', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(4, 'Video Framer', 'Tool to generate framed or templated videos', 'No. of video framers made', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(5, 'Custom Form', 'Tailor-made online form for data collection', 'No. of forms made', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(6, 'Brand Gamification', 'Interactive game-based experience for brand engagement', 'No. of gamiifications made', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(7, 'E- Flipbook', 'Digital booklet with flip-page effect', 'No. of e-flipbook made', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(8, 'Quiz Application', 'Online quiz tool with scoring and logic', 'No. of quiz applications made', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(9, 'HTML Mailer', 'Email template coded in HTML', 'No. of mailers made', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(10, 'QR Code', 'Generate custom QR codes', 'No. of qr codes made', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(11, 'Static Website', 'Simple informational website without backend', 'No. of websites made', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(12, 'Dynamic Website', 'Website with backend, database, and dynamic content', 'No. of dynamic websites made', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(13, 'Custom Web Application', 'Applications based on custom requirements', 'No. of applications made', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(14, 'Brand Communication Strategy', 'Creation of brand identity, strategy, and core assets', 'No. of collaterals/story/slogan/pay-off line made', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(15, 'Creative Copywriting', 'Written content for all kind of digital, print, UX, and communications', 'No. of collaterals made', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(16, 'Marketing & Social Media Creatives', 'All posts, ads, static graphics', 'No. of graphic collaterals made', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(17, 'Branding & Corporate Identity', 'Identity-building assets', 'No. of graphic collaterals made', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(18, 'Packaging & Label Design', 'Print packaging-related projects', 'No. of graphic collaterals made', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(19, 'Publication & Print Layouts', 'Long-format or structured print', 'No. of graphic collaterals made', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(20, 'Illustrations & Visual Art', 'Any sketch or creative drawing', 'No. of graphic collaterals made', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(21, 'Pharma/Medical Artwork', 'Pharma-specific assets like VA, LBL, etc', 'No. of graphic collaterals made', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(22, 'Exhibition & Display Assets', 'Event/stall materials', 'No. of graphic collaterals made', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(23, 'Photo Manipulation & Advanced Edits', 'Creative photo work', 'No. of graphic collaterals made', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(24, 'UI & Other Asset Production', 'Assets for web/app UI and other things', 'No. of graphic collaterals made', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(25, '2D Animation', 'Full 2D animated video creation', 'No. of video collaterals made', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(26, '3D Animation', '3D animation creation', 'No. of video collaterals made', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(27, 'Motion Graphics', 'Animated explainers and corporate videos', 'No. of video collaterals made', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(28, 'Short-form Animated Assets', 'Small looping/unlooped media', 'No. of video collaterals made', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(29, 'Video Editing & Post Production', 'Editing of recorded/raw footage', 'No. of video collaterals made', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(30, 'Video Shoot & Editing', 'All types of shooting & editing work', 'No. of video collaterals made', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(31, 'Photography & Post-Production', 'Products, people or event shoots & editing work', 'No. of still collaterals made', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(32, 'Audio Recording & Post-Production', 'All types of recording & editing of recorded/raw audio', 'No. of audio collaterals made', '2025-11-11 06:52:31', '2025-11-11 06:52:31');

-- --------------------------------------------------------

--
-- Table structure for table `request_division_reference`
--

CREATE TABLE `request_division_reference` (
  `id` int(11) NOT NULL,
  `request_id` int(11) NOT NULL,
  `division_id` int(11) NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

--
-- Dumping data for table `request_division_reference`
--

INSERT INTO `request_division_reference` (`id`, `request_id`, `division_id`, `created_at`, `updated_at`) VALUES
(1, 1, 4, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(2, 2, 1, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(3, 3, 2, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(4, 4, 3, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(5, 5, 5, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(6, 6, 1, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(7, 6, 2, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(8, 6, 3, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(9, 6, 4, '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(10, 6, 5, '2025-11-11 06:52:31', '2025-11-11 06:52:31');

-- --------------------------------------------------------

--
-- Table structure for table `request_type`
--

CREATE TABLE `request_type` (
  `id` int(11) NOT NULL,
  `request_type` varchar(100) NOT NULL,
  `description` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

--
-- Dumping data for table `request_type`
--

INSERT INTO `request_type` (`id`, `request_type`, `description`, `created_at`, `updated_at`) VALUES
(1, 'Content Writing', 'Non-medical copywriting, Storyboarding, etc.', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(2, 'Design & Graphics', 'LBL, Standees, Social media post, Magazine, etc.', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(3, 'Video & Animation', 'Motivational video, Short clips, 2D/3D video animations, etc.', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(4, 'Photo, Video & Audio Shoot', 'Voice-overs, Product demos, Testimonials, etc.', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(5, 'Web & Digital Solutions', 'VA HTMLization, Websites, Brand gamifications, etc.', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(6, 'Consulting & Advisory', 'Preparation and guidance for outsourced projects', '2025-11-11 06:52:31', '2025-11-11 06:52:31');

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
  `task_name` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `request_type_id` int(11) NOT NULL,
  `task_type_id` int(11) NOT NULL,
  `work_request_id` int(11) NOT NULL,
  `deadline` date DEFAULT NULL,
  `status` enum('draft','pending','accepted','assigned','in_progress','completed','rejected','deferred') DEFAULT 'pending',
  `intimate_team` tinyint(1) DEFAULT 0,
  `task_count` int(11) DEFAULT 0,
  `link` varchar(500) DEFAULT NULL,
  `start_date` date DEFAULT NULL,
  `end_date` date DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

--
-- Dumping data for table `tasks`
--

INSERT INTO `tasks` (`id`, `task_name`, `description`, `request_type_id`, `task_type_id`, `work_request_id`, `deadline`, `status`, `intimate_team`, `created_at`, `updated_at`) VALUES
(1, 'Design Landing Page', 'Create responsive landing page design', 2, 43, 56, '2025-12-15', 'pending', 0, '2025-12-02 08:29:36', '2025-12-02 08:29:36'),
(2, 'Design Landing Page', 'Create responsive landing page design', 2, 1, 56, '2025-12-15', 'pending', 0, '2025-12-02 08:30:09', '2025-12-02 08:30:09'),
(3, 'Design Landing Page', 'Create responsive landing page design', 2, 2, 56, '2025-12-15', 'pending', 0, '2025-12-02 08:31:59', '2025-12-02 08:31:59');

-- --------------------------------------------------------

--
-- Table structure for table `task_assignments`
--

CREATE TABLE `task_assignments` (
  `id` int(11) NOT NULL,
  `task_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `link` varchar(500) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

--
-- Table structure for table `task_documents`
--

CREATE TABLE `task_documents` (
  `id` int(11) NOT NULL,
  `task_assignment_id` int(11) NOT NULL,
  `document_name` varchar(255) NOT NULL,
  `document_path` varchar(500) NOT NULL,
  `document_type` varchar(50) DEFAULT NULL,
  `document_size` int(11) DEFAULT NULL,
  `status` enum('uploading','uploaded','failed') DEFAULT 'uploading',
  `uploaded_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

--
-- Dumping data for table `task_assignments`
--

INSERT INTO `task_assignments` (`id`, `task_id`, `user_id`, `created_at`, `updated_at`) VALUES
(1, 1, 9, '2025-12-02 08:29:36', '2025-12-02 08:29:36'),
(2, 2, 10, '2025-12-02 08:30:09', '2025-12-02 08:30:09'),
(3, 3, 10, '2025-12-02 08:32:07', '2025-12-02 08:32:07');

-- --------------------------------------------------------

--
-- Table structure for table `task_dependencies`
--

CREATE TABLE `task_dependencies` (
  `id` int(11) NOT NULL,
  `task_id` int(11) NOT NULL,
  `dependency_task_id` int(11) NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

--
-- Dumping data for table `task_dependencies`
--

INSERT INTO `task_dependencies` (`id`, `task_id`, `dependency_task_id`, `created_at`, `updated_at`) VALUES
(1, 3, 1, '2025-12-02 08:32:11', '2025-12-02 08:32:11');

-- --------------------------------------------------------

--
-- Table structure for table `task_project_reference`
--

CREATE TABLE `task_project_reference` (
  `id` int(11) NOT NULL,
  `task_id` int(11) NOT NULL,
  `project_id` int(11) NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

--
-- Dumping data for table `task_project_reference`
--

INSERT INTO `task_project_reference` (`id`, `task_id`, `project_id`, `created_at`, `updated_at`) VALUES
(1, 1, 1, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(2, 2, 1, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(3, 3, 1, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(4, 4, 1, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(5, 5, 1, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(6, 6, 1, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(7, 7, 1, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(8, 8, 1, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(9, 9, 1, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(10, 10, 1, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(11, 11, 1, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(12, 12, 1, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(13, 13, 1, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(14, 14, 1, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(15, 15, 1, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(16, 16, 1, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(17, 1, 2, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(18, 2, 2, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(19, 3, 2, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(20, 4, 2, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(21, 5, 2, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(22, 6, 2, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(23, 7, 2, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(24, 8, 2, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(25, 9, 2, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(26, 10, 2, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(27, 11, 2, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(28, 12, 2, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(29, 13, 2, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(30, 14, 2, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(31, 15, 2, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(32, 16, 2, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(33, 1, 3, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(34, 2, 3, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(35, 3, 3, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(36, 4, 3, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(37, 5, 3, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(38, 6, 3, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(39, 7, 3, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(40, 8, 3, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(41, 9, 3, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(42, 10, 3, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(43, 11, 3, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(44, 12, 3, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(45, 13, 3, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(46, 14, 3, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(47, 15, 3, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(48, 16, 3, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(49, 1, 4, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(50, 2, 4, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(51, 3, 4, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(52, 4, 4, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(53, 5, 4, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(54, 6, 4, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(55, 7, 4, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(56, 8, 4, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(57, 9, 4, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(58, 10, 4, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(59, 11, 4, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(60, 12, 4, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(61, 13, 4, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(62, 14, 4, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(63, 15, 4, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(64, 16, 4, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(65, 1, 5, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(66, 2, 5, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(67, 3, 5, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(68, 4, 5, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(69, 5, 5, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(70, 6, 5, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(71, 7, 5, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(72, 8, 5, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(73, 9, 5, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(74, 10, 5, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(75, 11, 5, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(76, 12, 5, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(77, 13, 5, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(78, 14, 5, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(79, 15, 5, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(80, 16, 5, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(81, 1, 6, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(82, 2, 6, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(83, 3, 6, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(84, 4, 6, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(85, 5, 6, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(86, 6, 6, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(87, 7, 6, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(88, 8, 6, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(89, 9, 6, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(90, 10, 6, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(91, 11, 6, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(92, 12, 6, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(93, 13, 6, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(94, 14, 6, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(95, 15, 6, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(96, 16, 6, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(97, 1, 7, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(98, 2, 7, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(99, 3, 7, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(100, 4, 7, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(101, 5, 7, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(102, 6, 7, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(103, 7, 7, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(104, 8, 7, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(105, 9, 7, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(106, 10, 7, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(107, 11, 7, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(108, 12, 7, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(109, 13, 7, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(110, 14, 7, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(111, 15, 7, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(112, 16, 7, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(113, 1, 8, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(114, 2, 8, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(115, 3, 8, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(116, 4, 8, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(117, 5, 8, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(118, 6, 8, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(119, 7, 8, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(120, 8, 8, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(121, 9, 8, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(122, 10, 8, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(123, 11, 8, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(124, 12, 8, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(125, 13, 8, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(126, 14, 8, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(127, 15, 8, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(128, 16, 8, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(129, 1, 9, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(130, 2, 9, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(131, 3, 9, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(132, 4, 9, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(133, 5, 9, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(134, 6, 9, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(135, 7, 9, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(136, 8, 9, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(137, 9, 9, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(138, 10, 9, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(139, 11, 9, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(140, 12, 9, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(141, 13, 9, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(142, 14, 9, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(143, 15, 9, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(144, 16, 9, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(145, 1, 10, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(146, 2, 10, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(147, 3, 10, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(148, 4, 10, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(149, 5, 10, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(150, 6, 10, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(151, 7, 10, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(152, 8, 10, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(153, 9, 10, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(154, 10, 10, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(155, 11, 10, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(156, 12, 10, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(157, 13, 10, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(158, 14, 10, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(159, 15, 10, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(160, 16, 10, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(161, 1, 11, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(162, 2, 11, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(163, 3, 11, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(164, 4, 11, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(165, 5, 11, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(166, 6, 11, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(167, 7, 11, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(168, 8, 11, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(169, 9, 11, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(170, 10, 11, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(171, 11, 11, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(172, 12, 11, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(173, 13, 11, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(174, 14, 11, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(175, 15, 11, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(176, 16, 11, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(177, 1, 12, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(178, 2, 12, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(179, 3, 12, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(180, 4, 12, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(181, 5, 12, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(182, 6, 12, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(183, 7, 12, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(184, 8, 12, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(185, 9, 12, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(186, 10, 12, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(187, 11, 12, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(188, 12, 12, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(189, 13, 12, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(190, 14, 12, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(191, 15, 12, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(192, 16, 12, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(193, 1, 13, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(194, 2, 13, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(195, 3, 13, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(196, 4, 13, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(197, 5, 13, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(198, 6, 13, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(199, 7, 13, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(200, 8, 13, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(201, 9, 13, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(202, 10, 13, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(203, 11, 13, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(204, 12, 13, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(205, 13, 13, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(206, 14, 13, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(207, 15, 13, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(208, 16, 13, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(209, 17, 14, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(210, 18, 14, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(211, 19, 14, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(212, 20, 14, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(213, 21, 14, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(214, 22, 14, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(215, 23, 14, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(216, 24, 14, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(217, 25, 14, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(218, 26, 14, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(219, 27, 14, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(220, 28, 15, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(221, 29, 15, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(222, 30, 15, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(223, 31, 15, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(224, 32, 16, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(225, 33, 16, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(226, 34, 16, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(227, 35, 16, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(228, 36, 16, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(229, 37, 16, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(230, 38, 16, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(231, 39, 16, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(232, 40, 16, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(233, 41, 16, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(234, 42, 16, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(235, 43, 17, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(236, 44, 17, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(237, 45, 17, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(238, 46, 17, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(239, 47, 17, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(240, 48, 17, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(241, 49, 18, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(242, 50, 18, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(243, 51, 19, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(244, 52, 19, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(245, 53, 19, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(246, 54, 19, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(247, 55, 20, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(248, 56, 20, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(249, 57, 20, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(250, 58, 21, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(251, 59, 21, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(252, 60, 21, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(253, 61, 21, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(254, 62, 21, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(255, 63, 21, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(256, 64, 21, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(257, 65, 21, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(258, 66, 21, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(259, 67, 21, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(260, 68, 21, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(261, 69, 22, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(262, 70, 22, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(263, 71, 22, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(264, 72, 22, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(265, 73, 23, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(266, 74, 24, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(267, 75, 24, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(268, 76, 26, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(269, 77, 26, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(270, 78, 27, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(271, 79, 27, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(272, 80, 27, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(273, 81, 27, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(274, 82, 27, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(275, 83, 27, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(276, 84, 28, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(277, 85, 28, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(278, 86, 28, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(279, 87, 28, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(280, 88, 28, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(281, 89, 29, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(282, 90, 30, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(283, 91, 30, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(284, 92, 30, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(285, 93, 30, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(286, 94, 31, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(287, 95, 31, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(288, 96, 31, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(289, 97, 31, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(290, 98, 31, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(291, 99, 32, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(292, 100, 32, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(293, 101, 32, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(294, 17, 15, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(295, 18, 15, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(296, 19, 15, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(297, 20, 15, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(298, 21, 15, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(299, 22, 15, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(300, 23, 15, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(301, 24, 15, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(302, 25, 15, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(303, 26, 15, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(304, 27, 15, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(305, 78, 25, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(306, 79, 25, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(307, 80, 25, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(308, 81, 25, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(309, 82, 25, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(310, 83, 25, '2025-11-25 06:35:16', '2025-11-25 06:35:16'),
(311, 89, 30, '2025-11-25 06:35:16', '2025-11-25 06:35:16');

-- --------------------------------------------------------

--
-- Table structure for table `task_type`
--

CREATE TABLE `task_type` (
  `id` int(11) NOT NULL,
  `task_type` varchar(100) NOT NULL,
  `description` text DEFAULT NULL,
  `quantification` varchar(100) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

--
-- Dumping data for table `task_type`
--

INSERT INTO `task_type` (`id`, `task_type`, `description`, `quantification`, `created_at`, `updated_at`) VALUES
(1, 'Front-End Development', 'Coding', 'No. of screens developed', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(2, 'Back-End Development', 'Coding', 'No. of screens developed', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(3, 'API Development', 'Coding', 'No. of apis\' developed', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(4, 'Database Development', 'Coding', 'No. of data tables created', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(5, 'Schema - Data Modelling, ERD', 'Coding', 'No. of erd created', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(6, 'Application Testing', 'Coding', 'No. of applications tested', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(7, 'Application Deployment', 'Coding', 'No. of times application was deployed', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(8, 'QR Generation', 'Coding', 'No. of qr codes generated', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(9, 'User Research Reports (Interviews, Surveys, Usability Testing)', 'UIUX', 'No. of reports generated', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(10, 'User Personas and Segmentation', 'UIUX', 'No. of reports generated', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(11, 'Product Vision and Strategy', 'UIUX', 'No. of reports generated', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(12, 'Product Roadmap and Release Plan', 'UIUX', 'No. of reports generated', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(13, 'User Journey Maps or User Flow Diagrams', 'UIUX', 'No. of diagrams made', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(14, 'Information Architecture and Content Structures', 'UIUX', 'No. of structures made', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(15, 'High-Fidelity UI Mockups and Prototypes', 'UIUX', 'No. of screens designed', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(16, 'Responsive UI Design Adaptations', 'UIUX', 'No. of screens adapted', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(17, 'Emailers', 'Creative Copywriting + Brand Communication Strategy', 'No. of emailers written', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(18, 'Speech Write-up', 'Creative Copywriting + Brand Communication Strategy', 'No. of speeches written', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(19, 'Social Media Content', 'Creative Copywriting + Brand Communication Strategy', 'No. of content written', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(20, 'Graphic Content', 'Creative Copywriting + Brand Communication Strategy', 'No. of content written', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(21, 'Video Script', 'Creative Copywriting + Brand Communication Strategy', 'No. of script written', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(22, 'Storyboarding', 'Creative Copywriting + Brand Communication Strategy', 'No. of story written', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(23, 'Festival Content', 'Creative Copywriting + Brand Communication Strategy', 'No. of content written', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(24, 'Articles/Blogs', 'Creative Copywriting + Brand Communication Strategy', 'No. of articles/blogs written', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(25, 'UI write-up', 'Creative Copywriting + Brand Communication Strategy', 'No. of screens written', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(26, 'Proofreading', 'Creative Copywriting + Brand Communication Strategy', 'No. of collateral checked', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(27, 'Transcription', 'Creative Copywriting + Brand Communication Strategy', 'No. of collateral checked', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(28, 'Concept', 'Brand Communication Strategy', 'No. of collateral written', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(29, 'Brand Stories & Narratives', 'Brand Communication Strategy', 'No. of story built', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(30, 'Brand Mascot Profiles', 'Brand Communication Strategy', 'No. of plans created', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(31, 'Slogan/Pay-off/Tag Line', 'Brand Communication Strategy', 'No. of line made', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(32, 'Festival Greetings', 'Marketing & Social Media Creatives', 'No. of collaterals designed', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(33, 'Whatsapp Creative', 'Marketing & Social Media Creatives', 'No. of collaterals designed', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(34, 'Teaser', 'Marketing & Social Media Creatives', 'No. of collaterals designed', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(35, 'Leaflet', 'Marketing & Social Media Creatives', 'No. of collaterals designed', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(36, 'Flyer', 'Marketing & Social Media Creatives', 'No. of collaterals designed', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(37, 'Mailer', 'Marketing & Social Media Creatives', 'No. of collaterals designed', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(38, 'Certificate', 'Marketing & Social Media Creatives', 'No. of collaterals designed', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(39, 'Banner', 'Marketing & Social Media Creatives', 'No. of collaterals designed', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(40, 'Poster', 'Marketing & Social Media Creatives', 'No. of collaterals designed', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(41, 'Card', 'Marketing & Social Media Creatives', 'No. of collaterals designed', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(42, 'Invitation Card', 'Marketing & Social Media Creatives', 'No. of collaterals designed', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(43, 'Logo', 'Branding & Corporate Identity', 'No. of collaterals designed', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(44, 'Mascot', 'Branding & Corporate Identity + 2D Animation', 'No. of collaterals designed', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(45, 'Visiting Card', 'Branding & Corporate Identity', 'No. of collaterals designed', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(46, 'Bookmark', 'Branding & Corporate Identity', 'No. of collaterals designed', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(47, 'Badge', 'Branding & Corporate Identity', 'No. of collaterals designed', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(48, 'Sticker', 'Branding & Corporate Identity', 'No. of collaterals designed', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(49, 'Packaging', 'Packaging & Label Design', 'No. of collaterals designed', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(50, 'Jacket Folder', 'Packaging & Label Design', 'No. of collaterals designed', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(51, 'Booklet', 'Publication & Print Layouts', 'No. of collaterals designed', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(52, 'Diary', 'Publication & Print Layouts', 'No. of collaterals designed', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(53, 'Comicbook', 'Publication & Print Layouts', 'No. of collaterals designed', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(54, 'Calendar Design', 'Publication & Print Layouts', 'No. of collaterals designed', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(55, 'Illustrations', 'Illustrations & Visual Art', 'No. of collaterals designed', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(56, 'Sketches', 'Illustrations & Visual Art', 'No. of collaterals designed', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(57, 'Wallpaper', 'Illustrations & Visual Art', 'No. of collaterals designed', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(58, 'Visual Aid', 'Pharma/Medical Artwork', 'No. of collaterals designed', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(59, 'Cover Page', 'Pharma/Medical Artwork', 'No. of collaterals designed', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(60, 'LBL', 'Pharma/Medical Artwork', 'No. of collaterals designed', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(61, 'Detailer', 'Pharma/Medical Artwork', 'No. of collaterals designed', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(62, 'Prescription Pad', 'Pharma/Medical Artwork', 'No. of collaterals designed', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(63, 'RCPA Card', 'Pharma/Medical Artwork', 'No. of collaterals designed', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(64, 'Chit Pad', 'Pharma/Medical Artwork', 'No. of collaterals designed', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(65, 'Reminder Card', 'Pharma/Medical Artwork', 'No. of collaterals designed', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(66, 'Gimmick', 'Pharma/Medical Artwork', 'No. of collaterals designed', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(67, 'Magazine Ad', 'Pharma/Medical Artwork', 'No. of collaterals designed', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(68, 'Questionnaire Design', 'Pharma/Medical Artwork', 'No. of collaterals designed', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(69, 'Stall Panel', 'Exhibition & Display Assets', 'No. of collaterals designed', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(70, 'Table Top', 'Exhibition & Display Assets', 'No. of collaterals designed', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(71, 'Standee', 'Exhibition & Display Assets', 'No. of collaterals designed', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(72, 'Dangler', 'Exhibition & Display Assets', 'No. of collaterals designed', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(73, 'Photo Manipulation', 'Photo Manipulation & Advanced Edits', 'No. of collaterals designed', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(74, 'Template', 'UI & Other Asset Production', 'No. of collaterals designed', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(75, 'Photo Frame', 'UI & Other Asset Production', 'No. of collaterals designed', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(76, '3D Animation', '3D Animation', 'No. of video collaterals made', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(77, '3D Modelling', '3D Animation', 'No. of video collaterals made', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(78, 'Logo & Identity Animation', '2D Animation + Motion Graphics', 'No. of video collaterals made', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(79, 'Explainer & Instructional Motion Videos', '2D Animation + Motion Graphics', 'No. of video collaterals made', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(80, 'Infographic & Data Visualization Motion Videos', '2D Animation + Motion Graphics', 'No. of video collaterals made', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(81, 'Promo & Marketing Motion Videos', '2D Animation + Motion Graphics', 'No. of video collaterals made', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(82, 'Corporate & Brand Storytelling Motions', '2D Animation + Motion Graphics', 'No. of video collaterals made', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(83, 'Mode of Action Videos', '2D Animation + Motion Graphics', 'No. of video collaterals made', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(84, 'VA Animation', 'Short-form Animated Assets', 'No. of video collaterals made', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(85, 'GIF', 'Short-form Animated Assets', 'No. of video collaterals made', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(86, 'Stop Motion', 'Short-form Animated Assets', 'No. of video collaterals made', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(87, 'Animated Stickers', 'Short-form Animated Assets', 'No. of video collaterals made', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(88, 'Festival Video', 'Short-form Animated Assets', 'No. of video collaterals made', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(89, 'Video Editing', 'Video Editing & Post Production + Video Shoot & Editing', 'No. of video collaterals made', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(90, 'Testimonial Shoot', 'Video Shoot & Editing', 'No. of video collaterals shot', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(91, 'Event Shoot', 'Video Shoot & Editing', 'No. of video collaterals shot', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(92, 'Detailing Shoot', 'Video Shoot & Editing', 'No. of video collaterals shot', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(93, 'Concept Shoot', 'Video Shoot & Editing', 'No. of video collaterals shot', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(94, 'Portrait Photography', 'Photography & Post-Production', 'No. of still collaterals shot', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(95, 'Product Photography', 'Photography & Post-Production', 'No. of still collaterals shot', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(96, 'Event Photography', 'Photography & Post-Production', 'No. of still collaterals shot', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(97, 'Stop Motion Shoot', 'Photography & Post-Production', 'No. of still collaterals shot', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(98, 'Photo Editing', 'Photography & Post-Production', 'No. of still collaterals shot', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(99, 'Voice Over', 'Audio Recording & Post-Production', 'No. of audio collaterals shot', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(100, 'SFX', 'Audio Recording & Post-Production', 'No. of audio collaterals shot', '2025-11-11 06:52:31', '2025-11-11 06:52:31'),
(101, 'Audio Editing', 'Audio Recording & Post-Production', 'No. of audio collaterals shot', '2025-11-11 06:52:31', '2025-11-11 06:52:31');

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
(9, 'Bhagwan Parab', 'bhagwan.parab@alembic.co.in', '1234567890', '$2a$10$13zqXGBAuAF/pcF4XHxvi.lEo8flBZCOnw/qq.fBJfZ57eAJcfj42', 9, 2, 1, 16, 1, 'active', NULL, 0, NULL, '2025-11-25 06:14:31', '2026-02-23 06:14:31', '2025-11-25 06:10:40', '2025-11-25 06:14:31'),
(10, 'Harsh Gohil', 'harsh.gohil@alembic.co.in', '1234567890', '$2a$10$Kc.lwpVnKYKTOyVEkEaR5eCEcMqK7SjbnjpwgIB.LiAN/pLagxVeO', 9, 4, 1, 20, 1, 'active', '2025-11-26 04:00:05', 0, NULL, '2025-11-25 06:15:53', '2026-02-23 06:15:53', '2025-11-25 06:14:56', '2025-11-26 04:00:05'),
(11, 'Mohanish Padwal', 'mohanish.padwal@alembic.co.in', '1234567890', '$2a$10$lbDnrhd.6O4EvCFNTeDt1.SngPt.IqHZkvw3jtUwjKTrEWoIbcDO.', 9, 2, 1, 16, 1, 'active', '2025-12-02 08:29:34', 0, NULL, '2025-11-25 06:17:31', '2026-02-23 06:17:31', '2025-11-25 06:16:23', '2025-12-02 08:29:34'),
(12, 'Nikhil Nadkar', 'nikhil.nadkar@alembic.co.in', '1234567890', '$2a$10$Txudkx41QciW8euyVoodNOIa4seUXViVsWc.UN3RCdxg0KrcFfssW', 1, 5, 1, 8, 1, 'active', '2025-12-02 08:26:57', 0, NULL, '2025-11-25 06:19:02', '2026-02-23 06:19:02', '2025-11-25 06:17:55', '2025-12-02 08:26:57'),
(13, 'Gautam Barnawal', 'gautam.baranwal@alembic.co.in', '1234567890', '$2a$10$ELYSn.TNQYl4.ppKulgaFeenW5Stt3wzMzeymt1O0hyAfzxnKGxZq', 9, 4, 1, 19, 1, 'active', NULL, 0, NULL, '2025-11-26 02:42:48', '2026-02-24 02:42:48', '2025-11-25 10:46:13', '2025-11-26 02:42:48'),
(14, 'Vinisha Chadala', 'vinisha.chadala@alembic.co.in', '1234567890', '$2a$10$Fehw59cHdrrS0KdlB.koo.3aqM85F0soHulTlyn7Ga9ICb7XBbFGe', 9, 4, 1, 19, 1, 'active', NULL, 0, NULL, '2025-11-26 04:20:56', '2026-02-24 04:20:56', '2025-11-26 04:19:06', '2025-11-26 04:20:56'),
(15, 'Vikaram Rai', 'vikramr.rai@alembic.co.in', '1234567890', '$2a$10$eMdj3uvEko0L26oRtV0veeoxZzMsiHwaHdW66FQ63bBN3ssboQN6q', 9, 2, 1, 16, 1, 'active', NULL, 0, NULL, '2025-11-26 04:33:08', '2026-02-24 04:33:08', '2025-11-26 04:31:28', '2025-11-26 04:33:08');

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
(12, 9, 1, '2025-11-25 06:14:31', '2025-11-25 06:14:31'),
(13, 10, 5, '2025-11-25 06:15:53', '2025-11-25 06:15:53'),
(14, 11, 2, '2025-11-25 06:17:31', '2025-11-25 06:17:31'),
(15, 11, 4, '2025-11-25 06:17:31', '2025-11-25 06:17:31'),
(16, 11, 5, '2025-11-25 06:17:31', '2025-11-25 06:17:31'),
(17, 12, 22, '2025-11-25 06:19:02', '2025-11-25 06:19:02'),
(18, 13, 5, '2025-11-26 02:42:48', '2025-11-26 02:42:48'),
(19, 14, 4, '2025-11-26 04:20:56', '2025-11-26 04:20:56'),
(20, 15, 3, '2025-11-26 04:33:07', '2025-11-26 04:33:07'),
(21, 15, 4, '2025-11-26 04:33:08', '2025-11-26 04:33:08');

-- --------------------------------------------------------

--
-- Table structure for table `work_requests`
--

CREATE TABLE `work_requests` (
  `id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `project_name` varchar(255) NOT NULL,
  `brand` varchar(100) DEFAULT NULL,
  `request_type_id` int(11) NOT NULL,
  `project_id` int(11) DEFAULT NULL,
  `about_project` text DEFAULT NULL,
  `priority` enum('low','medium','high','critical') DEFAULT 'medium',
  `status` enum('draft','pending','accepted','assigned','in_progress','completed','rejected') DEFAULT 'pending',
  `requested_at` datetime DEFAULT NULL,
  `remarks` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

--
-- Dumping data for table `work_requests`
--

INSERT INTO `work_requests` (`id`, `user_id`, `project_name`, `brand`, `request_type_id`, `project_id`, `about_project`, `priority`, `status`, `requested_at`, `remarks`, `created_at`, `updated_at`) VALUES
(56, 12, 'New Product Launch Campaign', 'Alembic Pharma', 5, 5, '{\"output_devices\":[\"iPad 9\",\"Mobile\"],\"target_audience\":[\"Doctors\",\"Chemists\"]}', 'high', 'accepted', '2025-12-02 08:27:36', 'Any additional remarks', '2025-12-02 08:27:36', '2025-12-02 08:28:08');

-- --------------------------------------------------------

--
-- Table structure for table `about_project`
--

CREATE TABLE `about_project` (
  `id` int(11) NOT NULL,
  `type` enum('output_devices','target_audience') NOT NULL,
  `category` varchar(100) NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

--
-- Dumping data for table `about_project`
--

INSERT INTO `about_project` (`id`, `type`, `category`, `created_at`, `updated_at`) VALUES
(1, 'output_devices', 'iPad 9', '2025-12-03 05:52:15', '2025-12-03 05:52:15'),
(2, 'output_devices', 'iPad 10', '2025-12-03 05:52:15', '2025-12-03 05:52:15'),
(3, 'output_devices', 'Mobile', '2025-12-03 05:52:15', '2025-12-03 05:52:15'),
(4, 'output_devices', 'Desktop', '2025-12-03 05:52:15', '2025-12-03 05:52:15'),
(5, 'output_devices', 'Print', '2025-12-03 05:52:15', '2025-12-03 05:52:15'),
(6, 'target_audience', 'Doctors', '2025-12-03 05:52:15', '2025-12-03 05:52:15'),
(7, 'target_audience', 'Field Representatives', '2025-12-03 05:52:15', '2025-12-03 05:52:15'),
(8, 'target_audience', 'Alembic HO', '2025-12-03 05:52:15', '2025-12-03 05:52:15'),
(9, 'target_audience', 'Chemists', '2025-12-03 05:52:15', '2025-12-03 05:52:15'),
(10, 'target_audience', 'Others', '2025-12-03 05:52:15', '2025-12-03 05:52:15');

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
  `status` enum('uploading','uploaded','failed') DEFAULT 'uploading',
  `uploaded_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

-- --------------------------------------------------------

--
-- Table structure for table `work_request_managers`
--

CREATE TABLE `work_request_managers` (
  `id` int(11) NOT NULL,
  `work_request_id` int(11) NOT NULL,
  `manager_id` int(11) NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

--
-- Dumping data for table `work_request_managers`
--

INSERT INTO `work_request_managers` (`id`, `work_request_id`, `manager_id`, `created_at`, `updated_at`) VALUES
(5, 56, 11, '2025-12-02 08:27:36', '2025-12-02 08:27:36');

--
-- Indexes for dumped tables
--

--
-- Indexes for table `department`
--
ALTER TABLE `department`
  ADD PRIMARY KEY (`id`);

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
-- Indexes for table `division`
--
ALTER TABLE `division`
  ADD PRIMARY KEY (`id`),
  ADD KEY `department_id` (`department_id`);

--
-- Indexes for table `issue_register`
--
ALTER TABLE `issue_register`
  ADD PRIMARY KEY (`id`);

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
-- Indexes for table `project_request_reference`
--
ALTER TABLE `project_request_reference`
  ADD PRIMARY KEY (`id`),
  ADD KEY `project_request_reference_ibfk_1` (`project_id`),
  ADD KEY `project_request_reference_ibfk_2` (`request_id`);

--
-- Indexes for table `project_type`
--
ALTER TABLE `project_type`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `request_division_reference`
--
ALTER TABLE `request_division_reference`
  ADD PRIMARY KEY (`id`),
  ADD KEY `request_id` (`request_id`),
  ADD KEY `division_id` (`division_id`);

--
-- Indexes for table `request_type`
--
ALTER TABLE `request_type`
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
  ADD KEY `task_type_id` (`task_type_id`),
  ADD KEY `work_request_id` (`work_request_id`),
  ADD KEY `request_type_id` (`request_type_id`);

--
-- Indexes for table `task_assignments`
--
ALTER TABLE `task_assignments`
  ADD PRIMARY KEY (`id`),
  ADD KEY `task_id` (`task_id`),
  ADD KEY `user_id` (`user_id`);

--
-- Indexes for table `task_documents`
--
ALTER TABLE `task_documents`
  ADD PRIMARY KEY (`id`),
  ADD KEY `task_assignment_id` (`task_assignment_id`);

--
-- Indexes for table `task_dependencies`
--
ALTER TABLE `task_dependencies`
  ADD PRIMARY KEY (`id`),
  ADD KEY `task_id` (`task_id`),
  ADD KEY `dependency_task_id` (`dependency_task_id`);

--
-- Indexes for table `task_project_reference`
--
ALTER TABLE `task_project_reference`
  ADD PRIMARY KEY (`id`),
  ADD KEY `task_id` (`task_id`),
  ADD KEY `project_id` (`project_id`);

--
-- Indexes for table `task_type`
--
ALTER TABLE `task_type`
  ADD PRIMARY KEY (`id`);

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
-- Indexes for table `work_requests`
--
ALTER TABLE `work_requests`
  ADD PRIMARY KEY (`id`),
  ADD KEY `user_id` (`user_id`),
  ADD KEY `request_type_id` (`request_type_id`),
  ADD KEY `project_id` (`project_id`),
  ADD KEY `idx_work_requests_status` (`status`),
  ADD KEY `idx_work_requests_priority` (`priority`),
  ADD KEY `idx_work_requests_created_at` (`created_at`),
  ADD KEY `idx_work_requests_updated_at` (`updated_at`),
  ADD KEY `idx_work_requests_project_name` (`project_name`),
  ADD KEY `idx_work_requests_brand` (`brand`),
  ADD KEY `idx_work_requests_search` (`status`,`priority`,`created_at`),
  ADD KEY `idx_work_requests_user_search` (`user_id`,`status`,`created_at`);
ALTER TABLE `work_requests` ADD FULLTEXT KEY `ft_work_requests_content` (`project_name`,`brand`,`about_project`);

--
-- Indexes for table `about_project`
--
ALTER TABLE `about_project`
  ADD PRIMARY KEY (`id`),
  ADD KEY `type` (`type`);

--
-- Indexes for table `work_request_documents`
--
ALTER TABLE `work_request_documents`
  ADD PRIMARY KEY (`id`),
  ADD KEY `work_request_id` (`work_request_id`);

--
-- Indexes for table `work_request_managers`
--
ALTER TABLE `work_request_managers`
  ADD PRIMARY KEY (`id`),
  ADD KEY `work_request_id` (`work_request_id`),
  ADD KEY `manager_id` (`manager_id`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `department`
--
ALTER TABLE `department`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=10;

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
-- AUTO_INCREMENT for table `division`
--
ALTER TABLE `division`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=41;

--
-- AUTO_INCREMENT for table `issue_register`
--
ALTER TABLE `issue_register`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=32;

--
-- AUTO_INCREMENT for table `job_role`
--
ALTER TABLE `job_role`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=20;

--
-- AUTO_INCREMENT for table `location`
--
ALTER TABLE `location`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=4;

--
-- AUTO_INCREMENT for table `project_request_reference`
--
ALTER TABLE `project_request_reference`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=65;

--
-- AUTO_INCREMENT for table `project_type`
--
ALTER TABLE `project_type`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=33;

--
-- AUTO_INCREMENT for table `request_division_reference`
--
ALTER TABLE `request_division_reference`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=11;

--
-- AUTO_INCREMENT for table `request_type`
--
ALTER TABLE `request_type`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=7;

--
-- AUTO_INCREMENT for table `sales`
--
ALTER TABLE `sales`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT for table `tasks`
--
ALTER TABLE `tasks`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=4;

--
-- AUTO_INCREMENT for table `task_assignments`
--
ALTER TABLE `task_assignments`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=4;

--
-- AUTO_INCREMENT for table `task_documents`
--
ALTER TABLE `task_documents`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=1;

--
-- AUTO_INCREMENT for table `task_dependencies`
--
ALTER TABLE `task_dependencies`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT for table `task_project_reference`
--
ALTER TABLE `task_project_reference`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=312;

--
-- AUTO_INCREMENT for table `task_type`
--
ALTER TABLE `task_type`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=102;

--
-- AUTO_INCREMENT for table `users`
--
ALTER TABLE `users`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=16;

--
-- AUTO_INCREMENT for table `user_divisions`
--
ALTER TABLE `user_divisions`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=22;

--
-- AUTO_INCREMENT for table `work_requests`
--
ALTER TABLE `work_requests`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=57;

--
-- AUTO_INCREMENT for table `about_project`
--
ALTER TABLE `about_project`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=11;

--
-- AUTO_INCREMENT for table `work_request_documents`
--
ALTER TABLE `work_request_documents`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=143;

--
-- AUTO_INCREMENT for table `work_request_managers`
--
ALTER TABLE `work_request_managers`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=6;

--
-- Constraints for dumped tables
--

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
-- Constraints for table `division`
--
ALTER TABLE `division`
  ADD CONSTRAINT `division_ibfk_1` FOREIGN KEY (`department_id`) REFERENCES `department` (`id`);

--
-- Constraints for table `job_role`
--
ALTER TABLE `job_role`
  ADD CONSTRAINT `job_role_ibfk_1` FOREIGN KEY (`department_id`) REFERENCES `department` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `project_request_reference`
--
ALTER TABLE `project_request_reference`
  ADD CONSTRAINT `project_request_reference_ibfk_1` FOREIGN KEY (`project_id`) REFERENCES `project_type` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `project_request_reference_ibfk_2` FOREIGN KEY (`request_id`) REFERENCES `request_type` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `request_division_reference`
--
ALTER TABLE `request_division_reference`
  ADD CONSTRAINT `request_division_reference_ibfk_1` FOREIGN KEY (`request_id`) REFERENCES `request_type` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `request_division_reference_ibfk_2` FOREIGN KEY (`division_id`) REFERENCES `division` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `sales`
--
ALTER TABLE `sales`
  ADD CONSTRAINT `sales_ibfk_1` FOREIGN KEY (`division_id`) REFERENCES `division` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `tasks`
--
ALTER TABLE `tasks`
  ADD CONSTRAINT `tasks_ibfk_2` FOREIGN KEY (`task_type_id`) REFERENCES `task_type` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `tasks_ibfk_3` FOREIGN KEY (`work_request_id`) REFERENCES `work_requests` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `tasks_ibfk_4` FOREIGN KEY (`request_type_id`) REFERENCES `request_type` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `task_assignments`
--
ALTER TABLE `task_assignments`
  ADD CONSTRAINT `task_assignments_ibfk_1` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `task_assignments_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `task_documents`
--
ALTER TABLE `task_documents`
  ADD CONSTRAINT `task_documents_ibfk_1` FOREIGN KEY (`task_assignment_id`) REFERENCES `task_assignments` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `task_dependencies`
--
ALTER TABLE `task_dependencies`
  ADD CONSTRAINT `task_dependencies_ibfk_1` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `task_dependencies_ibfk_2` FOREIGN KEY (`dependency_task_id`) REFERENCES `tasks` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `task_project_reference`
--
ALTER TABLE `task_project_reference`
  ADD CONSTRAINT `task_project_reference_ibfk_1` FOREIGN KEY (`task_id`) REFERENCES `task_type` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `task_project_reference_ibfk_2` FOREIGN KEY (`project_id`) REFERENCES `project_type` (`id`) ON DELETE CASCADE;

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
-- Constraints for table `work_requests`
--
ALTER TABLE `work_requests`
  ADD CONSTRAINT `work_requests_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `work_requests_ibfk_2` FOREIGN KEY (`request_type_id`) REFERENCES `request_type` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `work_requests_ibfk_3` FOREIGN KEY (`project_id`) REFERENCES `project_type` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `work_request_documents`
--
ALTER TABLE `work_request_documents`
  ADD CONSTRAINT `work_request_documents_ibfk_1` FOREIGN KEY (`work_request_id`) REFERENCES `work_requests` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `work_request_managers`
--
ALTER TABLE `work_request_managers`
  ADD CONSTRAINT `work_request_managers_ibfk_1` FOREIGN KEY (`work_request_id`) REFERENCES `work_requests` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `work_request_managers_ibfk_2` FOREIGN KEY (`manager_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
