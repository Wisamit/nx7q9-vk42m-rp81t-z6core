export type PatientAge = {
  value: number;
  unit: "DAY" | "MONTH" | "YEAR";
};

function utcDateOnly(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

export function calculatePatientAge(dateOfBirth: Date | null, at = new Date()): PatientAge | null {
  if (!dateOfBirth) return null;

  const dob = utcDateOnly(dateOfBirth);
  const reference = utcDateOnly(at);
  if (dob.getTime() > reference.getTime()) return null;

  const days = Math.floor((reference.getTime() - dob.getTime()) / 86_400_000);
  if (days < 60) return { value: days, unit: "DAY" };

  let months = (reference.getUTCFullYear() - dob.getUTCFullYear()) * 12
    + (reference.getUTCMonth() - dob.getUTCMonth());
  if (reference.getUTCDate() < dob.getUTCDate()) months -= 1;
  if (months < 24) return { value: Math.max(months, 0), unit: "MONTH" };

  let years = reference.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday =
    reference.getUTCMonth() < dob.getUTCMonth()
    || (reference.getUTCMonth() === dob.getUTCMonth() && reference.getUTCDate() < dob.getUTCDate());
  if (beforeBirthday) years -= 1;
  return { value: Math.max(years, 0), unit: "YEAR" };
}
