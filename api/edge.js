export default function handler(request) {
  return new Response(JSON.stringify({
    message: "This is a simple edge function responding to requests",
    method: request.method
  }), {
    headers: {
      'content-type': 'application/json'
    }
  });
} 