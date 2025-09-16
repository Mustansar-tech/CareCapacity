/**
 * Gender-based color utility for employee names
 * Provides consistent color coding across the dashboard
 */

export function getGenderColorClass(gender?: string): string {
  const normalizedGender = (gender || "").toLowerCase().trim();
  if (normalizedGender === "female") {
    return "text-pink-600 dark:text-pink-400"; // Pink for females
  } else if (normalizedGender === "male") {
    return "text-blue-600 dark:text-blue-400"; // Blue for males
  } else {
    return "text-gray-900 dark:text-gray-100"; // Default color for unknown gender
  }
}