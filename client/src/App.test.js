import { render, screen } from '@testing-library/react';
import App from './App';

test('renders lobby title', () => {
  render(<App />);
  const headingElement = screen.getByText(/mesh meet mvp/i);
  expect(headingElement).toBeInTheDocument();
});
