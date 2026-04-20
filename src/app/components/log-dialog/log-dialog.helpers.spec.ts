import { preserveCategoryDescriptions } from '../shared/category-description.util';

describe('LogDialog category helpers', () => {
  test('copies description into Andet when Andet field is empty', () => {
    const next = preserveCategoryDescriptions('Andet', 'Typed text', '');
    expect(next).toEqual({ description: 'Typed text', andetDescription: 'Typed text' });
  });

  test('keeps Andet field value when already set', () => {
    const next = preserveCategoryDescriptions('Andet', 'Typed text', 'Other existing');
    expect(next).toEqual({ description: 'Typed text', andetDescription: 'Other existing' });
  });

  test('copies Andet field back to base description when leaving Andet', () => {
    const next = preserveCategoryDescriptions('Projekt', '', 'Other existing');
    expect(next).toEqual({ description: 'Other existing', andetDescription: 'Other existing' });
  });
});
