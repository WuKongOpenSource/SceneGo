























export * from './scriptPrompts';


export * from './storyboardPrompts';


export * from './imagePrompts';


export * from './scriptPipelinePrompts';











export function fillPrompt(template: string, variables: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return result;
}







export function combinePrompts(parts: string[], separator: string = '\n\n'): string {
  return parts.filter(Boolean).join(separator);
}








export function addSuffix(base: string, suffix: string, separator: string = ', '): string {
  return `${base}${separator}${suffix}`;
}

