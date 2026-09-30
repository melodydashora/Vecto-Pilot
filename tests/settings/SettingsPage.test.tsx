import { jest } from '@jest/globals';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AuthApiResponse, DriverProfile, DriverVehicle } from '../../client/src/types/auth';

const mockToast = jest.fn();
const mockUpdateProfile = jest.fn();
let mockAuth: { user: { userId: string }; profile: DriverProfile; vehicle: DriverVehicle; isLoading: boolean; updateProfile: typeof mockUpdateProfile };
jest.mock('@/contexts/auth-context', () => ({ useAuth: () => mockAuth }));
const mockFinishSave = jest.fn(async () => true);
const mockBeginSave = jest.fn(() => () => {});
jest.mock('@/contexts/run-setup-context', () => ({ useRunSetup: () => ({
  setup: { settingsRevision: 1, profile: mockAuth.profile, vehicle: mockAuth.vehicle },
  getEditorDraft: () => null, setEditorDraft: () => {}, draftResetVersion: 0, loading: false, beginSave: mockBeginSave, finishSave: mockFinishSave,
}) }));
jest.mock('@/hooks/useToast', () => ({ useToast: () => ({ toast: mockToast }) }));
jest.mock('@/utils/co-pilot-helpers', () => ({ getAuthHeader: () => ({}) }));
import SettingsPage from '../../client/src/pages/co-pilot/SettingsPage';

function account(id = 'alice') {
  return {
    user: { userId: id }, isLoading: false, updateProfile: mockUpdateProfile,
    profile: {
      id: `profile-${id}`, userId: id, firstName: id, lastName: 'Driver', nickname: `${id} saved`,
      email: `${id}@example.test`, phone: '5555555555', address1: '1 Test Lane', address2: '', city: 'Dallas',
      stateTerritory: 'TX', zipCode: '75001', country: 'US', market: 'Dallas',
      selectedServices: ['economy'], ridesharePlatforms: ['uber', 'private', 'legacy-service'], eligEconomy: true, eligXl: false,
      eligXxl: false, eligComfort: false, eligLuxurySedan: false, eligLuxurySuv: false,
      attrElectric: false, attrGreen: false, attrWav: false, attrSki: false, attrCarSeat: false,
      prefPetFriendly: false, prefTeen: false, prefAssist: false, prefShared: false,
      marketingOptIn: false, termsAccepted: true, emailVerified: true, phoneVerified: false, profileComplete: true,
    } as DriverProfile,
    vehicle: { id: `vehicle-${id}`, driverProfileId: `profile-${id}`, year: 2020, make: 'Test', model: 'Car', seatbelts: 4, isPrimary: true },
  };
}

function tab(name: string) {
  fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0, ctrlKey: false });
}
function mount() {
  let view: ReturnType<typeof render>;
  try { view = render(<MemoryRouter><SettingsPage /></MemoryRouter>); }
  catch (error) { throw error instanceof AggregateError ? error.errors[0] : error; }
  return { ...view, redraw: () => view.rerender(<MemoryRouter><SettingsPage /></MemoryRouter>) };
}

beforeEach(() => {
  mockAuth = account();
  mockUpdateProfile.mockResolvedValue({ success: true });
  globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
  globalThis.fetch = jest.fn(async (url: string | URL | Request) => {
    const path = String(url);
    const data = path.includes('add-market') ? { success: true, market_name: 'Market A' }
      : path.includes('countries') ? { countries: [{ value: 'US', label: 'United States' }] }
      : path.includes('regions') ? { regions: [{ value: 'TX', label: 'Texas' }] }
        : path.includes('years') ? { years: [2020] } : { markets: ['Dallas'] };
    return { ok: true, json: async () => data } as Response;
  });
});
afterEach(cleanup);

test('economic values load and save zero separately from a cleared unknown value', async () => {
  mockAuth.profile = { ...mockAuth.profile, fuelEconomyMpg: 31, earningsGoalDaily: 0, shiftHoursTarget: 7.5, maxDeadheadMi: 0 };
  mount();
  expect(screen.getByRole('spinbutton', { name: 'Daily earnings goal' })).toHaveValue(0);
  expect(screen.getByRole('spinbutton', { name: 'Maximum empty pickup distance (miles)' })).toHaveValue(0);
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Fuel economy (mpg)' }), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save and review' }));
  await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledTimes(1));
  expect(mockUpdateProfile.mock.calls[0][0]).toMatchObject({ fuelEconomyMpg: null, earningsGoalDaily: 0, shiftHoursTarget: 7.5, maxDeadheadMi: 0 });
  expect(screen.queryByRole('tab', { name: 'Connections' })).not.toBeInTheDocument();
});

test('background refresh preserves an edited economic goal while updating untouched economics', async () => {
  const view = mount();
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Daily earnings goal' }), { target: { value: '180.50' } });
  mockAuth.profile = { ...mockAuth.profile, earningsGoalDaily: 200, shiftHoursTarget: 8 };
  view.redraw();
  await waitFor(() => expect(screen.getByRole('spinbutton', { name: 'Target shift (hours)' })).toHaveValue(8));
  expect(screen.getByRole('spinbutton', { name: 'Daily earnings goal' })).toHaveValue(180.5);
});

test('one form preserves private/unknown IDs and false vehicle flags across accessible sections', async () => {
  const view = mount();
  expect(view.container.querySelectorAll('form')).toHaveLength(1);
  tab('Services');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Economy' }));
  tab('Black / premium');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Luxury Sedan' }));
  tab('Private / chauffeur');
  expect(screen.getByRole('checkbox', { name: 'Private / chauffeur' })).toBeChecked();
  tab('Vehicle');
  expect(screen.getByRole('textbox', { name: 'Make' })).toHaveValue('Test');
  tab('Services');
  tab('Ridehail');
  expect(screen.getByRole('checkbox', { name: 'Economy' })).not.toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Save and review' }));
  await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledTimes(1));
  expect(mockUpdateProfile.mock.calls[0][0]).toMatchObject({
    ridesharePlatforms: ['uber', 'private', 'legacy-service'], eligEconomy: false,
    eligLuxurySedan: true, eligLuxurySuv: false, prefShared: false,
  });
  expect(mockUpdateProfile.mock.calls[0][0].ridesharePlatforms).not.toContain('black');
});

test('background profile and vehicle refresh updates clean fields without erasing the draft', async () => {
  const view = mount();
  fireEvent.change(screen.getByRole('textbox', { name: 'Nickname' }), { target: { value: 'Unsent note' } });
  mockAuth = { ...mockAuth, profile: { ...mockAuth.profile, nickname: 'Remote nickname', phone: '5551112222' }, vehicle: { ...mockAuth.vehicle, make: 'New make' } };
  view.redraw();
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Phone Number' })).toHaveValue('5551112222'));
  expect(screen.getByRole('textbox', { name: 'Nickname' })).toHaveValue('Unsent note');
  expect(screen.getByText(/Unsaved changes/)).toBeInTheDocument();
  tab('Vehicle');
  expect(screen.getByRole('textbox', { name: 'Make' })).toHaveValue('New make');
});

test('a delayed save adopts canonical values but retains an edit reverted to its original value', async () => {
  let finish!: (result: { success: boolean; confirmedProfile?: AuthApiResponse }) => void;
  mockUpdateProfile.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = mount();
  fireEvent.change(screen.getByRole('textbox', { name: 'Nickname' }), { target: { value: 'Submitted' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save and review' }));
  await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByRole('textbox', { name: 'Nickname' }), { target: { value: 'alice saved' } });
  mockAuth = { ...mockAuth, profile: { ...mockAuth.profile, nickname: 'Submitted', phone: '+15555555555' } };
  view.redraw();
  expect(screen.getByRole('textbox', { name: 'Nickname' })).toHaveValue('alice saved');
  // 2026-09-11: the real provider returns this save's verified profile response;
  // a held background refresh alone is not proof of the saved canonical values.
  await act(async () => { finish({ success: true, confirmedProfile: { profile: mockAuth.profile, vehicle: mockAuth.vehicle } }); });
  expect(screen.getByRole('textbox', { name: 'Nickname' })).toHaveValue('alice saved');
  expect(screen.getByRole('textbox', { name: 'Phone Number' })).toHaveValue('+15555555555');
  expect(screen.getByText(/Unsaved changes/)).toBeInTheDocument();
  expect(mockToast).toHaveBeenLastCalledWith(expect.objectContaining({ description: expect.stringContaining('more changes') }));
});

test.each(['failure', 'exception'])('a save %s merges a held background refresh and preserves the draft for retry', async (outcome) => {
  let finish!: (value: unknown) => void;
  let fail!: (reason: Error) => void;
  mockUpdateProfile.mockImplementationOnce(() => new Promise((resolve, reject) => { finish = resolve; fail = reject; }));
  const view = mount();
  fireEvent.change(screen.getByRole('textbox', { name: 'Nickname' }), { target: { value: 'Keep this' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save and review' }));
  await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledTimes(1));
  mockAuth = { ...mockAuth, profile: { ...mockAuth.profile, phone: '5552223333' } };
  view.redraw();
  await act(async () => { if (outcome === 'failure') finish({ success: false, error: 'Offline' }); else fail(new Error('Offline')); });
  expect(screen.getByRole('textbox', { name: 'Nickname' })).toHaveValue('Keep this');
  expect(screen.getByRole('textbox', { name: 'Phone Number' })).toHaveValue('5552223333');
  fireEvent.click(screen.getByRole('button', { name: 'Save and review' }));
  await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledTimes(2));
  expect(mockUpdateProfile.mock.calls[1][0]).toMatchObject({ nickname: 'Keep this', phone: '5552223333' });
});

test('account replacement clears private draft immediately and ignores the old save completion', async () => {
  let finish!: (result: { success: boolean }) => void;
  mockUpdateProfile.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = mount();
  fireEvent.change(screen.getByRole('textbox', { name: 'Nickname' }), { target: { value: 'Private Alice draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save and review' }));
  await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledTimes(1));
  mockAuth = account('bob');
  view.redraw();
  expect(screen.getByRole('textbox', { name: 'Nickname' })).toHaveValue('bob saved');
  expect(screen.queryByDisplayValue('Private Alice draft')).not.toBeInTheDocument();
  await act(async () => { finish({ success: true }); });
  expect(screen.getByRole('textbox', { name: 'Nickname' })).toHaveValue('bob saved');
  expect(mockToast).not.toHaveBeenCalled();
});

test('a mismatched auth profile never displays the previous account settings', () => {
  mockAuth.user = { userId: 'bob' };
  mount();
  expect(screen.getByRole('status')).toHaveTextContent('Loading your settings');
  expect(screen.queryByDisplayValue('alice saved')).not.toBeInTheDocument();
});

test('validation reveals and focuses an invalid field in a hidden section', async () => {
  mount();
  tab('Location');
  fireEvent.change(screen.getByRole('textbox', { name: 'Base Address' }), { target: { value: '' } });
  tab('Services');
  fireEvent.click(screen.getByRole('button', { name: 'Save and review' }));
  await waitFor(() => expect(screen.getByRole('tab', { name: 'Location' })).toHaveAttribute('aria-selected', 'true'));
  expect(screen.getByRole('textbox', { name: 'Base Address' })).toHaveFocus();
  expect(screen.getByText('Address is required')).toBeVisible();
  expect(mockUpdateProfile).not.toHaveBeenCalled();
});

test('tab navigation with arrows uses real Radix controls without submitting', async () => {
  mount();
  const profileTab = screen.getByRole('tab', { name: 'Profile' });
  act(() => { profileTab.focus(); });
  fireEvent.keyDown(profileTab, { key: 'ArrowRight' });
  await waitFor(() => expect(screen.getByRole('tab', { name: 'Location' })).toHaveFocus());
  expect(mockUpdateProfile).not.toHaveBeenCalled();
});

test('validation reveals Location and focuses its invalid market Select trigger', async () => {
  mockAuth.profile.market = '';
  mount();
  tab('Location');
  await screen.findByRole('combobox', { name: 'Market' });
  tab('Services');
  fireEvent.click(screen.getByRole('button', { name: 'Save and review' }));
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Market' })).toHaveFocus());
  expect(mockUpdateProfile).not.toHaveBeenCalled();
});

test('an empty custom market reveals its labeled field from another section', async () => {
  mockAuth.profile.market = '__OTHER__';
  mount();
  tab('Location');
  await screen.findByRole('textbox', { name: 'Custom market name' });
  tab('Services');
  fireEvent.click(screen.getByRole('button', { name: 'Save and review' }));
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Custom market name' })).toHaveFocus());
  expect(screen.getByText('Please enter your market name')).toBeVisible();
  expect(mockUpdateProfile).not.toHaveBeenCalled();
});

test('custom market creation locks that dependent name while other pending edits remain editable', async () => {
  mockAuth.profile.market = '__OTHER__';
  let finish!: (value: unknown) => void;
  mockUpdateProfile.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  mount();
  tab('Location');
  const customName = await screen.findByRole('textbox', { name: 'Custom market name' });
  fireEvent.change(customName, { target: { value: 'Market A' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save and review' }));
  await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledTimes(1));
  expect(customName).toBeDisabled();
  expect(screen.getByRole('combobox', { name: 'Market' })).toBeDisabled();
  tab('Profile');
  fireEvent.change(screen.getByRole('textbox', { name: 'Nickname' }), { target: { value: 'Later edit' } });
  await act(async () => { finish({ success: true }); });
  expect(screen.getByRole('textbox', { name: 'Nickname' })).toHaveValue('Later edit');
  expect(screen.getByText(/Unsaved changes/)).toBeInTheDocument();
  expect(mockUpdateProfile.mock.calls[0][0].market).toBe('Market A');
});
