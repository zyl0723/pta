/*!
 * 常见基础题型的测试数据。
 * 说明：这些是按 PTA 基础题常见题型整理的「同类型练习」，用于自测输出格式；
 * 每题都附有参考实现，测试数据全部经过实际运行校验。
 */
(function (global) {
  "use strict";

  var H = "#include <stdio.h>\n";

  global.PTAProblems = [
    {
      id: "sum-two",
      title: "两数求和",
      summary: "读入两个整数，输出它们的和。",
      inputDesc: "一行，两个整数 a 和 b（用空格分隔）。",
      outputDesc: "一行，一个整数，表示 a + b。",
      samples: [
        { input: "3 4\n", output: "7\n" },
        { input: "-5 12\n", output: "7\n" },
        { input: "2000000000 2000000000\n", output: "4000000000\n" }
      ],
      reference: H + "int main(){ long long a, b; scanf(\"%lld %lld\", &a, &b); printf(\"%lld\\n\", a + b); return 0; }"
    },
    {
      id: "circle-area",
      title: "圆的面积",
      summary: "读入半径，输出圆的面积，保留 2 位小数（π 取 3.14159）。",
      inputDesc: "一行，一个实数 r（r > 0）。",
      outputDesc: "一行，面积保留 2 位小数。",
      samples: [
        { input: "2.0\n", output: "12.57\n" },
        { input: "1.5\n", output: "7.07\n" }
      ],
      reference: H + "int main(){ double r; scanf(\"%lf\", &r); printf(\"%.2f\\n\", 3.14159 * r * r); return 0; }"
    },
    {
      id: "average",
      title: "求平均值",
      summary: "读入 n 个整数，输出它们的平均值，保留 1 位小数。",
      inputDesc: "第一行一个整数 n；第二行 n 个整数。",
      outputDesc: "一行，平均值保留 1 位小数。",
      samples: [
        { input: "3\n1 2 4\n", output: "2.3\n" },
        { input: "5\n80 90 75 88 92\n", output: "85.0\n" }
      ],
      reference: H + "int main(){ int n, i, x, s = 0; scanf(\"%d\", &n); for (i = 0; i < n; i++){ scanf(\"%d\", &x); s += x; } printf(\"%.1f\\n\", (double)s / n); return 0; }"
    },
    {
      id: "max-value",
      title: "求最大值",
      summary: "读入 n 个整数，输出其中最大的一个。",
      inputDesc: "第一行一个整数 n（n ≥ 1）；第二行 n 个整数。",
      outputDesc: "一行，最大值。",
      samples: [
        { input: "5\n3 7 2 9 4\n", output: "9\n" },
        { input: "3\n-5 -2 -9\n", output: "-2\n" }
      ],
      reference: H + "int main(){ int n, i, x, mx; scanf(\"%d\", &n); scanf(\"%d\", &mx); for (i = 1; i < n; i++){ scanf(\"%d\", &x); if (x > mx) mx = x; } printf(\"%d\\n\", mx); return 0; }"
    },
    {
      id: "prime",
      title: "判断素数",
      summary: "读入一个正整数，判断它是不是素数。",
      inputDesc: "一行，一个整数 n（n ≥ 2）。",
      outputDesc: "是素数输出 Yes，否则输出 No。",
      samples: [
        { input: "7\n", output: "Yes\n" },
        { input: "9\n", output: "No\n" },
        { input: "2\n", output: "Yes\n" }
      ],
      reference: H + "#include <math.h>\nint main(){ int n, i, ok = 1; scanf(\"%d\", &n); for (i = 2; i <= (int)sqrt(n); i++){ if (n % i == 0){ ok = 0; break; } } printf(\"%s\\n\", ok ? \"Yes\" : \"No\"); return 0; }"
    },
    {
      id: "factorial",
      title: "求 n 的阶乘",
      summary: "读入 n，输出 n!。注意结果可能超出 int 的范围。",
      inputDesc: "一行，一个整数 n（1 ≤ n ≤ 20）。",
      outputDesc: "一行，n! 的值。",
      samples: [
        { input: "5\n", output: "120\n" },
        { input: "20\n", output: "2432902008176640000\n".replace("2432902008176640000", "2432902008176640000") }
      ],
      reference: H + "int main(){ int n, i; long long f = 1; scanf(\"%d\", &n); for (i = 2; i <= n; i++) f *= i; printf(\"%lld\\n\", f); return 0; }"
    },
    {
      id: "reverse-string",
      title: "字符串反转",
      summary: "读入一行不含空格的字符串，把它反过来输出。",
      inputDesc: "一行，一个不含空格的非空字符串。",
      outputDesc: "一行，反转后的字符串。",
      samples: [
        { input: "abcde\n", output: "edcba\n" },
        { input: "12345\n", output: "54321\n" }
      ],
      reference: H + "#include <string.h>\nint main(){ char s[200], t; int i, n; scanf(\"%s\", s); n = strlen(s); for (i = 0; i < n / 2; i++){ t = s[i]; s[i] = s[n - 1 - i]; s[n - 1 - i] = t; } printf(\"%s\\n\", s); return 0; }"
    },
    {
      id: "array-sum",
      title: "数组求和",
      summary: "读入 n 个整数并存入数组，输出它们的总和。",
      inputDesc: "第一行一个整数 n；第二行 n 个整数。",
      outputDesc: "一行，总和。",
      samples: [
        { input: "4\n1 2 3 4\n", output: "10\n" },
        { input: "6\n10 20 30 40 50 60\n", output: "210\n" }
      ],
      reference: H + "int main(){ int n, i, a[100]; long long s = 0; scanf(\"%d\", &n); for (i = 0; i < n; i++) scanf(\"%d\", &a[i]); for (i = 0; i < n; i++) s += a[i]; printf(\"%lld\\n\", s); return 0; }"
    },
    {
      id: "count-letters",
      title: "统计字母个数",
      summary: "读入一行字符，统计其中英文字母的个数（遇到换行结束）。",
      inputDesc: "一行字符。",
      outputDesc: "一行，字母的个数。",
      samples: [
        { input: "Hello World 123\n", output: "10\n" },
        { input: "abc\n", output: "3\n" }
      ],
      reference: H + "#include <ctype.h>\nint main(){ int c, n = 0; while ((c = getchar()) != '\\n' && c != EOF){ if (isalpha(c)) n++; } printf(\"%d\\n\", n); return 0; }"
    },
    {
      id: "bubble-sort",
      title: "升序排序",
      summary: "读入 n 个整数，按从小到大的顺序输出，用空格分隔。",
      inputDesc: "第一行一个整数 n；第二行 n 个整数。",
      outputDesc: "一行，排序后的 n 个整数，相邻两个数之间有一个空格。",
      samples: [
        { input: "5\n5 3 1 4 2\n", output: "1 2 3 4 5\n" },
        { input: "4\n-1 0 -3 7\n", output: "-3 -1 0 7\n" }
      ],
      reference: H + "int main(){ int n, i, j, t, a[100]; scanf(\"%d\", &n); for (i = 0; i < n; i++) scanf(\"%d\", &a[i]); for (i = 0; i < n - 1; i++) for (j = 0; j < n - 1 - i; j++) if (a[j] > a[j + 1]){ t = a[j]; a[j] = a[j + 1]; a[j + 1] = t; } for (i = 0; i < n; i++){ if (i > 0) printf(\" \"); printf(\"%d\", a[i]); } printf(\"\\n\"); return 0; }"
    },
    {
      id: "grade",
      title: "成绩等级",
      summary: "按分数转换成等级：90 及以上 A，80~89 B，70~79 C，60~69 D，60 以下 E。",
      inputDesc: "一行，一个整数分数（0 ~ 100）。",
      outputDesc: "一行，一个大写字母等级。",
      samples: [
        { input: "95\n", output: "A\n" },
        { input: "83\n", output: "B\n" },
        { input: "59\n", output: "E\n" }
      ],
      reference: H + "int main(){ int s; scanf(\"%d\", &s); if (s >= 90) printf(\"A\\n\"); else if (s >= 80) printf(\"B\\n\"); else if (s >= 70) printf(\"C\\n\"); else if (s >= 60) printf(\"D\\n\"); else printf(\"E\\n\"); return 0; }"
    },
    {
      id: "narcissus",
      title: "水仙花数",
      summary: "输出 100 ~ 999 之间所有的水仙花数（各位数字立方和等于它本身），每行一个。",
      inputDesc: "无输入。",
      outputDesc: "每行一个水仙花数。",
      samples: [
        { input: "", output: "153\n370\n371\n407\n" }
      ],
      reference: H + "int main(){ int n, a, b, c; for (n = 100; n <= 999; n++){ a = n / 100; b = n / 10 % 10; c = n % 10; if (a * a * a + b * b * b + c * c * c == n) printf(\"%d\\n\", n); } return 0; }"
    }
  ];
})(typeof window !== "undefined" ? window : globalThis);