# Page snapshot

```yaml
- generic [ref=e4]:
  - generic [ref=e5]:
    - generic [ref=e7]: VP
    - generic [ref=e8]: Welcome Back
    - generic [ref=e9]: Sign in to your VectoPilot account
  - generic [ref=e10]:
    - generic [ref=e11]:
      - generic [ref=e12]:
        - text: Email
        - textbox "Email" [ref=e13]:
          - /placeholder: driver@example.com
      - generic [ref=e14]:
        - text: Password
        - textbox "Password" [ref=e15]:
          - /placeholder: Enter your password
      - link "Forgot password?" [ref=e17] [cursor=pointer]:
        - /url: /auth/forgot-password
      - button "Sign In" [ref=e18]
    - generic [ref=e23]: or continue with
    - generic [ref=e24]:
      - button "Continue with Google" [ref=e25]:
        - img [ref=e26]
        - generic [ref=e31]: Continue with Google
      - button "Continue with Apple" [ref=e32]:
        - img [ref=e33]
        - generic [ref=e35]: Continue with Apple
    - generic [ref=e36]:
      - text: Don't have an account?
      - link "Sign up" [ref=e37] [cursor=pointer]:
        - /url: /auth/sign-up
```