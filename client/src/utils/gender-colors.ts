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

/**
 * Gender-based background color utility for dots/indicators
 * Provides consistent color coding for circular indicators
 */
export function getGenderBgColorClass(gender?: string): string {
  const normalizedGender = (gender || "").toLowerCase().trim();
  if (normalizedGender === "female") {
    return "bg-pink-500 dark:bg-pink-400"; // Pink background for females
  } else if (normalizedGender === "male") {
    return "bg-blue-500 dark:bg-blue-400"; // Blue background for males
  } else {
    return "bg-gray-400 dark:bg-gray-500"; // Default background for unknown gender
  }
}