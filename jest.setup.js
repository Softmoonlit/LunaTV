import '@testing-library/jest-dom/extend-expect';

// Allow router mocks.
// eslint-disable-next-line no-undef
jest.mock('next/router', () => require('next-router-mock'));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Headers, Request, Response } = require('next/dist/compiled/node-fetch');

global.Headers = Headers;
global.Request = Request;
global.Response = Response;

if (!Response.json) {
  Response.json = (data, init) =>
    new Response(JSON.stringify(data), {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...init?.headers,
      },
    });
}
